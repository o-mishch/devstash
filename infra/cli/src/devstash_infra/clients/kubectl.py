"""clients/kubectl.py — a typed facade over the kubectl CLI. CLI zone (3.14).

kubectl is a CLI with no first-class Python surface we want here (the official client is heavy and
we keep argv control for parity), so this stays subprocess behind a typed facade. It starts minimal
— only `current_context`, the read the #10 cluster-targeting guard needs — and grows the mutating
verbs (apply/rollout/get) alongside the gke orchestration + ci ensure-* entrypoints.
"""

from collections.abc import Mapping

from devstash_infra.shared import proc
from devstash_infra.shared.proc import Result


class Kubectl:
    """`kubectl …`. Context read + rollout wait; display `get`/`logs` verbs land with gke status."""

    def current_context(self) -> str:
        """`kubectl config current-context`, or "" if none/unreadable (a tolerant read)."""
        result = proc.run(["kubectl", "config", "current-context"], check=False)
        return result.out if result.ok else ""

    def cluster_info(self) -> bool:
        """True iff the API server answers `kubectl cluster-info` — the control-plane reachability.

        The reachability oracle for `wait_for_cluster` [fix #11]: after a fresh apply / deep-suspend
        resume the cluster reports RUNNING before its DNS-based endpoint answers kubectl, so this is
        polled until it succeeds. Tolerant (never raises) — an unreachable endpoint is the expected
        "still propagating" state the poll retries, not an error.
        """
        return proc.run(["kubectl", "cluster-info"], check=False).ok

    def rollout_status(self, resource: str, *, namespace: str, timeout: str) -> None:
        """`kubectl -n <ns> rollout status <resource> --timeout=<t>` — block until rolled out.

        Raises `ProcError` on timeout/failure. The ESO install runs this on the validating-webhook
        Deployment: CR-admission needs the webhook live before the overlay's SecretStore is
        accepted, so both the serial `eso` and the parallel `ensure_operators` wait on it here.
        """
        proc.run(
            ["kubectl", "-n", namespace, "rollout", "status", resource, f"--timeout={timeout}"]
        )

    def annotate(self, resource: str, key: str, value: str, *, namespace: str) -> None:
        """`kubectl -n <ns> annotate <resource> <key>=<value> --overwrite` — best-effort.

        Never raises: the wait-secrets-sync re-nudge writes a fresh `force-sync` annotation each
        loop so ESO re-reads Secret Manager immediately, but the resource may not exist yet on a
        first bring-up, and a failed nudge is harmless (the wait still reports the real state).
        """
        proc.run(
            ["kubectl", "-n", namespace, "annotate", resource, f"{key}={value}", "--overwrite"],
            check=False,
        )

    def wait_condition(
        self, resource: str, condition: str, *, namespace: str, timeout: str
    ) -> bool:
        """`kubectl -n <ns> wait --for=condition=<c> <resource> --timeout=<t>` → True iff met.

        Tolerant (returns False on timeout) — the caller drives the re-nudge/classify loop, so a
        timeout is a normal not-yet-Ready signal, not an error.
        """
        return proc.run(
            [
                "kubectl", "-n", namespace, "wait", f"--for=condition={condition}",
                resource, f"--timeout={timeout}",
            ],
            check=False,
        ).ok  # fmt: skip

    def newest_event_message(self, name: str, reason: str, *, namespace: str) -> Result:
        """Newest matching Event's `.message` — `get events --field-selector … --sort-by … -o …`.

        Returns the raw `Result` (tolerant) so the caller can distinguish a kubectl FAILURE (RBAC
        denial, API unreachable — rc≠0, a real error) from an empty match (rc=0, no such event) —
        wait-secrets-sync must never fold those together. `--sort-by=.lastTimestamp` + the
        `[-1:]` jsonpath take only the NEWEST event, so a stale benign event can't mask a fault.
        """
        return proc.run(
            [
                "kubectl", "-n", namespace, "get", "events",
                "--field-selector", f"involvedObject.name={name},reason={reason}",
                "--sort-by=.lastTimestamp", "-o", "jsonpath={.items[-1:].message}",
            ],
            check=False,
        )  # fmt: skip

    def describe(self, resource: str, *, namespace: str) -> str:
        """`kubectl -n <ns> describe <resource>` stdout (tolerant → "" on failure).

        A diagnostic read for the loud-fail branches; never raises so a describe miss can't mask
        the fault it is trying to explain.
        """
        result = proc.run(["kubectl", "-n", namespace, "describe", resource], check=False)
        return result.stdout if result.ok else ""

    def get_raw(self, path: str) -> Result:
        """`kubectl get --raw=<path>` — hit an API-server path directly (e.g. `/readyz`).

        Returns the raw `Result` (tolerant): rc=0 → the control plane answered; rc≠0 → the caller
        inspects `stdout`+`stderr` to tell a Google-Front-End 403 HTML rejection (drift) from a
        plain unreachable runner. No namespace — this is a cluster-scoped control-plane probe.
        """
        return proc.run(["kubectl", "get", f"--raw={path}"], check=False)

    def get(
        self,
        target: str,
        *,
        namespace: str,
        output: str | None = None,
        sort_by: str | None = None,
        selector: str | None = None,
    ) -> str:
        """`get <target> [-l <sel>] [--sort-by=<s>] [-o <output>]` stdout (tolerant → "").

        A display read for the loud-fail diagnostics (Gateway/HTTPRoute status, namespace events)
        and the local `status` app-pod list (`-l app.kubernetes.io/name=devstash`); never raises, so
        a failed diagnostic can't mask the fault it is meant to explain.
        """
        argv = ["kubectl", "-n", namespace, "get", target]
        if selector is not None:
            argv += ["-l", selector]
        if sort_by is not None:
            argv.append(f"--sort-by={sort_by}")
        if output is not None:
            argv += ["-o", output]
        result = proc.run(argv, check=False)
        return result.stdout if result.ok else ""

    def pod_names(self, selector: str, *, namespace: str) -> list[str]:
        """`kubectl -n <ns> get pods -l <selector> -o name` → the `pod/<name>` lines (tolerant).

        `logs --previous` is rejected alongside a label selector, so previous-container logs for a
        selector must be collected pod-by-pod — this yields the names to loop over. "" → [].
        """
        result = proc.run(
            ["kubectl", "-n", namespace, "get", "pods", "-l", selector, "-o", "name"], check=False
        )
        return result.out.splitlines() if result.ok else []

    def previous_logs(self, pod: str, *, namespace: str, tail: int) -> str:
        """`kubectl -n <ns> logs <pod> --previous --tail=<n>` stdout (tolerant → "").

        The crashed container's last lines — the highest-signal rollout-failure diagnostic. Absent
        on a first-ever start (no previous container), so tolerant by design.
        """
        result = proc.run(
            ["kubectl", "-n", namespace, "logs", pod, "--previous", f"--tail={tail}"], check=False
        )
        return result.stdout if result.ok else ""

    def apply_stdin(self, manifest: str, *, server_side: bool = False) -> None:
        """`kubectl apply [--server-side] -f -` with `manifest` on stdin — apply a doc. Raises.

        Piping avoids the shell's temp-file dance (`yq … > /tmp/… ; kubectl apply -f /tmp/…`); the
        transformed YAML never touches disk. No `-n`: the manifest carries its own `namespace`. The
        local `apply_slice --server-side` sets `server_side` for a PLAIN server-side apply (no
        field-manager / force-conflicts — that stronger posture is the ci `apply_server_side`).
        """
        argv = ["kubectl", "apply", *(["--server-side"] if server_side else []), "-f", "-"]
        proc.run(argv, input=manifest)

    def apply_file(self, path: str) -> None:
        """`kubectl apply -f <path>` — apply a static manifest file. Raises.

        The local migrate Job is a committed YAML applied by path (unlike the rendered slices piped
        on stdin); kept distinct so its argv matches the shell's `kubectl apply -f <file>`.
        """
        proc.run(["kubectl", "apply", "-f", path])

    def kustomize(self, directory: str) -> str:
        """`kubectl kustomize <directory>` — render an overlay to a multi-doc YAML string. Raises.

        The rendered output is written ONCE to a shared file so the infra apply and the web rollout
        apply the exact same manifests (a real migrate→rollout gate, not a re-render race).
        """
        return proc.run(["kubectl", "kustomize", directory]).stdout

    def apply_server_side(self, manifest: str, *, field_manager: str) -> None:
        """Server-side apply `manifest` on stdin (--force-conflicts, given --field-manager). Raises.

        The SSA posture the deploy shares: a stable field-manager so re-applies converge, and
        `--force-conflicts` is safe because base/deployment.yaml omits `replicas` (the HPA is its
        sole owner), so this never stomps the HPA's scaling.
        """
        proc.run(
            [
                "kubectl", "apply", "--server-side", "--force-conflicts",
                f"--field-manager={field_manager}", "-f", "-",
            ],
            input=manifest,
        )  # fmt: skip

    def ensure_namespace(self, namespace: str) -> None:
        """`create namespace <ns> --dry-run=client -o yaml | apply -f -` — idempotent. Raises.

        The dry-run→apply idiom the shell used so a re-run never errors on an existing namespace
        (`create` alone fails on AlreadyExists); rendered to YAML then piped through `apply_stdin`.
        """
        rendered = proc.run(
            ["kubectl", "create", "namespace", namespace, "--dry-run=client", "-o", "yaml"]
        ).stdout
        self.apply_stdin(rendered)

    def apply_secret_from_files(
        self, name: str, files: Mapping[str, str], *, namespace: str
    ) -> None:
        """`create secret generic <name> --from-file=<k>=<path> … --dry-run=client -o yaml | apply`.

        The same idempotent dry-run→apply idiom as `ensure_namespace`, for the local Valkey TLS
        Secret (ca.crt/tls.crt/tls.key). Rendering then applying means a re-`up` rotates the cert
        material in place rather than erroring on the existing Secret. Raises on render/apply error.
        """
        argv = ["kubectl", "-n", namespace, "create", "secret", "generic", name]
        argv += [f"--from-file={key}={path}" for key, path in files.items()]
        argv += ["--dry-run=client", "-o", "yaml"]
        self.apply_stdin(proc.run(argv).stdout)

    def rollout_restart(self, resource: str, *, namespace: str) -> None:
        """`kubectl -n <ns> rollout restart <resource>` — trigger a fresh rollout. Raises.

        The local fast-iterate `deploy` restarts the web Deployment so a rebuilt-and-reloaded image
        with the same `:local` tag actually redeploys (kind reuses the tag, so SSA alone wouldn't
        roll the pods).
        """
        proc.run(["kubectl", "-n", namespace, "rollout", "restart", resource])

    def delete(self, kind: str, name: str, *, namespace: str) -> None:
        """`delete <kind> <name> --ignore-not-found` — idempotent one-off cleanup. Raises on error.

        apply-infra uses this to remove the legacy GCE-Ingress stack (Ingress/BackendConfig/
        FrontendConfig/ManagedCertificate) that fell out of the Gateway-API overlay: a plain SSA
        apply never deletes objects no longer in the manifest set, so the old classic-ALB Ingress
        would linger and bill. `--ignore-not-found` makes it a clean no-op on every later deploy.
        """
        proc.run(["kubectl", "-n", namespace, "delete", kind, name, "--ignore-not-found"])

    def delete_job(self, job: str, *, namespace: str) -> None:
        """`delete job <job> --ignore-not-found --cascade=foreground` — block until gone. Raises.

        A Job's pod template is immutable, so a prior run must be fully removed before re-applying.
        `--cascade=foreground` waits for the Job AND its pod to terminate, so the follow-up apply
        can't race a still-terminating pod; `--ignore-not-found` makes "no prior job" a no-op.
        """
        proc.run(
            [
                "kubectl", "-n", namespace, "delete", "job", job,
                "--ignore-not-found", "--cascade=foreground",
            ]
        )  # fmt: skip

    def job_condition(self, job: str, condition: str, *, namespace: str) -> str:
        """Status of `job`'s `<condition>` condition ("True"/"False"/""), via `-o jsonpath`.

        Tolerant → "" while the condition is absent (the Job hasn't reached it yet) or the read
        fails — the gate poll treats an empty read as "not yet", never an error.
        """
        result = proc.run(
            [
                "kubectl", "-n", namespace, "get", "job", job,
                "-o", f'jsonpath={{.status.conditions[?(@.type=="{condition}")].status}}',
            ],
            check=False,
        )  # fmt: skip
        return result.out if result.ok else ""

    def job_logs(self, job: str, *, namespace: str, tail: int) -> str:
        """`kubectl -n <ns> logs job/<job> --tail=<n>` stdout (tolerant → "").

        Used both to preserve a prior failed run's logs before deleting it and to dump the current
        Job's logs; a missing Job (no prior run) is normal, so tolerant.
        """
        result = proc.run(
            ["kubectl", "-n", namespace, "logs", f"job/{job}", f"--tail={tail}"], check=False
        )
        return result.stdout if result.ok else ""

    def selector_logs(self, selector: str, *, namespace: str, tail: int) -> str:
        """`logs -l <selector> --tail=<n> --prefix --ignore-errors` stdout (tolerant → "").

        The `gcp logs` display: tails EVERY matching pod at once, `--prefix` naming each line's pod
        so interleaved output stays attributable and `--ignore-errors` tolerating a pod that is
        mid-restart. Tolerant — a display read must never raise (no pods yet is a normal state).
        """
        result = proc.run(
            [
                "kubectl", "-n", namespace, "logs", "-l", selector,
                f"--tail={tail}", "--prefix", "--ignore-errors",
            ],
            check=False,
        )  # fmt: skip
        return result.stdout if result.ok else ""
