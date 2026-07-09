"""gcp/gke.py — GKE/kubectl-facing operations for the deploy tooling.

CLI zone (3.14). Ports the logic-bearing core of run/gcp/lib/gke.sh: the cluster-targeting guard
[fix #10] and the fail-fast parallel join [fix #11]. Re-architected onto the Python-native paradigm:
a `Gke` COLLABORATOR over `GcpConfig` + the typed `Tofu`/`Kubectl` clients (die → raise). The thin
helm/kubectl orchestration wrappers (eso/reloader/upgrade_helm/status/logs) are glue over the ci/
ensure-* entrypoints and land with that layer; the incident-critical branches are here.

Incident fixes:
  #10 use_cluster refuses to proceed unless kubectl's context is a GKE context — a get-credentials
      that silently failed (or a stale local-kind context) must NOT let a downstream kubectl mutate
      the wrong cluster.
  #11 join_fail_fast returns only once ALL jobs exit 0; the instant the FIRST fails it KILLS every
      surviving sibling (no detached install/apply left running) and raises — with optional per-path
      "✓ [label] done in <dur>" narration.
"""

import contextlib
import json
import shlex
import subprocess
import time
from collections.abc import Callable, Sequence
from dataclasses import dataclass
from pathlib import Path
from typing import cast

import typer

from devstash_infra.ci.operators import (
    ESO,
    RELOADER,
    ensure_operator,
    helm_failure_policy,
)
from devstash_infra.clients.gcloud import Gcloud
from devstash_infra.clients.health import deep_health_report
from devstash_infra.clients.helm import Helm
from devstash_infra.clients.kubectl import Kubectl
from devstash_infra.clients.tofu import Tofu
from devstash_infra.common import DEVSTASH_NS as _NS
from devstash_infra.common import confirm, count_missing, fmt_dur, log, ok, warn
from devstash_infra.config import GcpConfig
from devstash_infra.shared import proc
from devstash_infra.shared.errors import ClusterUnreachable, InfraError
from devstash_infra.versions import ESO_KEY, RELOADER_KEY, Versions, set_version

# The consolidated Secret Manager secret + the ExternalSecret ESO syncs it into. ALL app
# credentials live as JSON properties of this ONE secret (see modules/iam + external-secrets.yaml).
# These are resource NAMES, not values — the S105 "hardcoded password" heuristic misfires here.
_APP_CONFIG_SECRET = "devstash-app-config"  # noqa: S105 — Secret Manager resource name
_EXTERNAL_SECRET = "devstash-secrets"  # noqa: S105 — ExternalSecret resource name

# Keys that must be present regardless of suspend state — ESO needs them to materialise
# devstash-secrets so pods can start. Non-secret config (EMAIL_FROM, OAuth client ids, Stripe
# publishable/price ids, uploads-bucket, s3-endpoint/region) is intentionally ABSENT: it lives in
# the devstash-config ConfigMap (settings.yaml), NOT Secret Manager.
_APP_CONFIG_REQUIRED_KEYS = (
    "auth-secret",
    "auth-github-secret",
    "auth-google-secret",
    "resend-api-key",
    "stripe-secret-key",
    "stripe-webhook-secret",
    "openai-api-key",
    "s3-access-id",
    "s3-secret",
)

# Conditional infra keys — present only while the env is ACTIVE (Cloud SQL + Memorystore up),
# absent when suspended. Reported informationally so an operator can read active-vs-suspended state.
_APP_CONFIG_INFRA_KEYS = (
    "database-url",
    "direct-url",
    "database-ca-cert",
    "redis-url",
    "redis-ca-cert",
)

# Operator-supplied credentials `rotate-secret` may replace. Generated database/Redis/GCS values are
# Terraform-owned (they rotate through their source resources); the non-secret config ids live in
# settings.yaml — neither is rotatable here. Exposed for the (future) gcp boundary to pre-validate
# the name before prompting for a value, so the method + boundary can't disagree on what is allowed.
ROTATABLE_SECRETS = (
    "auth-secret",
    "auth-github-secret",
    "auth-google-secret",
    "resend-api-key",
    "stripe-secret-key",
    "stripe-webhook-secret",
    "openai-api-key",
)


def _app_config_keys(blob: str) -> list[str]:
    """Top-level property names of the app-config JSON blob (tolerant → [] on empty/garbage).

    Keys only — a value is never surfaced. Invalid JSON (or a non-object) yields an empty key list,
    so the caller reports every required key as missing (the shell's `jq -r 'keys[]' … || true`).
    """
    if not blob:
        return []
    try:
        parsed: object = json.loads(blob)
    except json.JSONDecodeError:
        return []
    if not isinstance(parsed, dict):
        return []
    return list(cast("dict[str, object]", parsed))


def _with_property(blob: str, key: str, value: str) -> str:
    """Return the app-config JSON blob with a single property replaced (the rest untouched).

    The consolidated-secret update: read the blob, replace ONE property, serialise. Parsing +
    re-dumping in Python keeps both the key name and the value out of any subprocess argv (no jq
    program text, no shell-history/process-list exposure) — the whole blob is fed on stdin.
    """
    parsed: object = json.loads(blob)
    if not isinstance(parsed, dict):
        raise InfraError("devstash-app-config is not a JSON object — cannot rotate a property")
    data = cast("dict[str, object]", parsed)
    data[key] = value
    return json.dumps(data)


def kube_context_is_gke(context: str) -> bool:
    """True iff `context` looks like a gcloud-named GKE context (gke.sh:23).

    gcloud always names them `gke_<project>_<location>_<cluster>`. The belt-and-suspenders check
    after a get-credentials whose failure `use_cluster_soft` swallows.
    """
    return context.startswith("gke_")


@dataclass(frozen=True)
class Gke:
    """GKE cluster-targeting + operator orchestration over the typed clients.

    Holds the incident-critical cluster guards (`use_cluster` [#10]) and the thin helm/kubectl
    orchestration wrappers (`eso`/`reloader`/`upgrade_helm`) that delegate the actual install to the
    single-source `ci/operators.py` — exactly as gke.sh's `eso()`/`reloader()` called
    `infra/ci/ensure-*.sh`. `kubectl` reads the active context [#10]; `helm` drives the installs.
    """

    config: GcpConfig
    tofu: Tofu
    kubectl: Kubectl
    helm: Helm

    def _credentials_command(self) -> str | None:
        """The tofu-emitted `get_credentials_command`, or None if it is not a gcloud command.

        Read via `output -json` [#2] — never `-raw`. When the env is suspended the output is a
        human-readable sentinel (not a gcloud command); an empty or non-`gcloud` value means
        "no cluster", the same signal the shell's `gcloud*` prefix guard produced.
        """
        command = self.tofu.output_json().value("get_credentials_command")
        return command if command.startswith("gcloud") else None

    def use_cluster(self, *, message: str | None = None) -> None:
        """Point kubeconfig at the GKE cluster, or raise [fix #10] (gke.sh:38).

        Runs the tofu-emitted get-credentials command, then REFUSES to proceed unless the resulting
        kubectl context is a GKE context — so a silently-failed get-credentials (leaving kubectl on
        whatever context, e.g. local kind) can never let a downstream kubectl-mutating step hit the
        wrong cluster. Every mutating entry point calls this.
        """
        command = self._credentials_command()
        if command is None:
            raise InfraError(message or "no cluster yet — run 'apply' first")
        # The command is verbatim tofu-emitted data (a full `gcloud … get-credentials …`), so it is
        # run as-is via proc — not rebuilt through a typed method (there is no argv to construct).
        proc.run(shlex.split(command))
        context = self.kubectl.current_context()
        if not kube_context_is_gke(context):
            raise InfraError(
                f"get-credentials ran but kubectl context is not a GKE context ('{context}') "
                "— refusing to proceed against a possibly-wrong cluster"
            )

    def use_cluster_soft(self, *, message: str | None = None) -> bool:
        """Best-effort variant for read-only status/log commands (gke.sh:45).

        Returns True once pointed at a GKE context; on any failure it WARNS and returns False (the
        caller proceeds partially-offline) instead of raising. Still surfaces a non-GKE context as a
        warning so a wrong-cluster read is at least visible.
        """
        command = self._credentials_command()
        if command is None:
            warn(message or "no cluster yet")
            return False
        if not proc.run(shlex.split(command), check=False).ok:
            warn(message or "no cluster yet")
            return False
        context = self.kubectl.current_context()
        if not kube_context_is_gke(context):
            warn(
                f"get-credentials ran but kubectl context is not a GKE context ('{context}') "
                "— subsequent kubectl calls may target the wrong cluster"
            )
        return True

    # ── operator orchestration (serial run.sh path: eso → reloader) ──────────
    def eso(self, versions_path: Path) -> None:
        """Install ESO (then Reloader) on the live cluster — the serial `run.sh eso` (gke.sh:69).

        Fetches cluster creds [#10 guard], delegates the install to the single-source
        `ensure_operator(ESO, …)` (same chart/version/--set CI runs), then waits for ESO's
        validating webhook so the overlay's SecretStore is accepted, and installs Reloader.
        """
        log("Installing External Secrets Operator (idempotent)")
        self.use_cluster()
        ensure_operator(
            ESO,
            Versions.load(versions_path).eso,
            helm=self.helm,
            failure_policy=helm_failure_policy(),
        )
        self._wait_eso_webhook()  # CR-admission needs the webhook live before SecretStore
        ok("ESO installed; SecretStore/ExternalSecret CRDs available")
        self.reloader(versions_path)

    def reloader(self, versions_path: Path) -> None:
        """Install Stakater Reloader on the live cluster — `run.sh reloader` (gke.sh:91)."""
        log("Installing Stakater Reloader (idempotent)")
        self.use_cluster()
        ensure_operator(
            RELOADER,
            Versions.load(versions_path).reloader,
            helm=self.helm,
            failure_policy=helm_failure_policy(),
        )
        ok("Stakater Reloader installed; Deployment auto-restarts on secret rotation")

    def _wait_eso_webhook(self) -> None:
        """Block until ESO's validating-webhook Deployment is rolled out (gke.sh:_wait_eso_webhook).

        The chart's own `--wait` covers ESO's Deployments, but CR-admission ALSO needs this webhook
        live before the overlay's SecretStore is accepted — single-sourced so the name/timeout can't
        drift between the serial and parallel install paths.
        """
        self.kubectl.rollout_status(
            "deploy/external-secrets-webhook", namespace="external-secrets", timeout="3m"
        )

    # ── upgrade-helm (bump both charts to latest, then reinstall) ────────────
    def upgrade_helm(
        self, versions_path: Path, *, ensure_tfvars: Callable[[], None], auto_approve: bool = False
    ) -> None:
        """Bump ESO + Reloader to their latest published chart versions, then reinstall (gke.sh).

        Freshens both repos, reads the latest chart version for each, and for any that drifted
        prompts (operator-gated — a chart bump can carry breaking changes) before rewriting
        versions.env in place. Then reinstalls via `eso` so the live cluster matches. Idempotent:
        `helm upgrade --install` is a no-op when already at the pinned version.
        """
        ensure_tfvars()
        self.use_cluster()

        log("Checking for Helm chart updates")
        self.helm.refresh_repo(ESO.repo_name, ESO.repo_url)
        self.helm.refresh_repo(RELOADER.repo_name, RELOADER.repo_url)

        latest_eso = self.helm.latest_chart_version(ESO.chart_ref)
        latest_reloader = self.helm.latest_chart_version(RELOADER.chart_ref)
        if not latest_eso:
            raise InfraError("could not fetch latest ESO chart version")
        if not latest_reloader:
            raise InfraError("could not fetch latest Reloader chart version")

        current = Versions.load(versions_path)
        self._maybe_bump(
            versions_path, ESO_KEY, "ESO", current.eso, latest_eso, auto_approve=auto_approve
        )
        self._maybe_bump(
            versions_path,
            RELOADER_KEY,
            "Reloader",
            current.reloader,
            latest_reloader,
            auto_approve=auto_approve,
        )

        log("Applying Helm chart versions to the cluster (eso + reloader)")
        self.eso(versions_path)

    def _maybe_bump(
        self,
        versions_path: Path,
        key: str,
        label: str,
        current: str,
        latest: str,
        *,
        auto_approve: bool,
    ) -> None:
        """Prompt-then-rewrite one pinned version if it drifted from latest (gke.sh:179-199)."""
        if current == latest:
            ok(f"{label} already at latest ({current})")
            return
        warn(f"{label}: {current} → {latest} (check release notes before upgrading)")
        if confirm(f"Upgrade {label} from {current} to {latest}?", auto_approve=auto_approve):
            set_version(versions_path, key, latest)
            ok(f"versions.env updated: {key}={latest}")

    # ── read-only display (gke.sh status/logs) ───────────────────────────────
    def status(
        self, gcloud: Gcloud, *, health_report: Callable[[str], str] = deep_health_report
    ) -> None:
        """Print a read-only health snapshot of the environment (gke.sh:216 status).

        Best-effort throughout — every read is tolerant, so a partially-up env still prints a useful
        picture rather than erroring. `gcloud` supplies the cert state; `health_report` is injected
        so the deep-health line runs without real HTTP.
        """
        log("Cluster status")
        self.use_cluster_soft()
        outputs = self.tofu.output_json()  # read once; reused for cert/ingress/domain below

        typer.echo("")
        log("Workloads")
        typer.echo(self.kubectl.get("deploy,statefulset,job,gateway,httproute", namespace=_NS))

        typer.echo("")
        log("Pods")
        typer.echo(self.kubectl.get("pods", namespace=_NS, output="wide"))

        typer.echo("")
        log("ExternalSecrets (ESO sync)")
        external_secrets = self.kubectl.get("externalsecret", namespace=_NS)
        if external_secrets:
            typer.echo(external_secrets)
        else:
            warn("no externalsecrets (ESO not installed?)")

        typer.echo("")
        log("Gateway + TLS certificate (Certificate Manager)")
        gateway = self.kubectl.get("gateway/devstash-web", namespace=_NS, output="wide")
        if gateway:
            typer.echo(gateway)
        else:
            warn("Gateway not found — overlay not applied yet")
        cert_name = outputs.value("cert_name")
        if cert_name:
            state = (
                gcloud.certificate_manager.cert_state(cert_name) or "unknown (run 'apply' first)"
            )
            typer.echo(f"  Cert '{cert_name}' state: {state}")
        warn("First-time only: the Google-managed cert provisions ~15-60 min after the DNS-auth")
        warn("CNAME resolves. Once ACTIVE it persists across suspend/resume — resume never waits.")

        typer.echo("")
        log("Infra")
        typer.echo(f"  Ingress IP: {outputs.value('ingress_ip_address', '—')}")
        typer.echo(f"  App domain: {outputs.value('app_domain', '—')}")

        typer.echo("")
        log("App health (deep — requires pod to be running)")
        domain = outputs.value("app_domain")
        if not domain:
            warn("app_domain not available — run 'apply' first")
            return
        report = health_report(f"https://{domain}/api/health?deep=1")
        if report:
            typer.echo(report)
        else:
            warn("health endpoint unreachable (cert provisioning or app not up yet)")

    def logs(self) -> None:
        """Tail the last 100 lines from every devstash-web pod, pod-prefixed (gke.sh:268 logs)."""
        self.use_cluster_soft()
        typer.echo(
            self.kubectl.selector_logs("app.kubernetes.io/name=devstash", namespace=_NS, tail=100)
        )

    # ── consolidated-secret verbs (run.sh verify_secrets / rotate_secret) ─────
    def verify_secrets(self, gcloud: Gcloud) -> None:
        """List the expected devstash-app-config keys and flag any missing, then report ESO sync.

        Ports `verify_secrets` (run.sh:1388). Read-only: `use_cluster_soft` so a suspended/parked
        env still checks Secret Manager (the app-config keys must exist regardless of suspend state)
        and only the ESO-sync half needs the cluster. `gcloud` supplies the newest-ENABLED read of
        the consolidated blob [#14]; values are never printed, only key presence.
        """
        log(f"Verifying Secret Manager secrets for project {self.config.project}")
        self.use_cluster_soft(
            message="cluster not reachable — secrets check runs against Secret Manager only"
        )

        blob = gcloud.secrets.access_blob(_APP_CONFIG_SECRET)
        if not blob:
            warn(
                "consolidated secret devstash-app-config is missing or unreadable — "
                "pods cannot start"
            )
            warn(
                "Apply Terraform (devstash-infra gcp apply) to create it, or see §7b of "
                "infra/docs/08-gcp-bootstrap.md"
            )
        keys = _app_config_keys(blob)

        if count_missing(keys, *_APP_CONFIG_REQUIRED_KEYS):
            warn(
                "required key(s) absent from devstash-app-config — pods will fail to start until "
                "all are present"
            )
            warn("See §7b of infra/docs/08-gcp-bootstrap.md for how to add them")
        else:
            ok(f"all {len(_APP_CONFIG_REQUIRED_KEYS)} required keys present in devstash-app-config")
            # Report the active-only infra keys so an operator can tell active from suspended state.
            present_infra = [key for key in _APP_CONFIG_INFRA_KEYS if key in keys]
            if present_infra:
                log(f"active-only infra keys present: {' '.join(present_infra)}")
            else:
                log("no infra keys (database-*/redis-*) present — consistent with a suspended env")

        self._report_eso_sync()

    def _report_eso_sync(self) -> None:
        """Report the ExternalSecret's Ready condition — Secret Manager presence ≠ K8s Secret sync.

        ESO must sync the consolidated secret into the cluster; a wrong key name, missing IAM
        binding, or un-installed ESO shows secrets present in Secret Manager but devstash-secrets
        missing (pods can't start until Ready=True). Existence is checked first (via `-o name`) so a
        not-found resource is distinguished from an existing-but-not-yet-Ready one.
        """
        log("ESO sync status (requires cluster access)")
        resource = f"externalsecret/{_EXTERNAL_SECRET}"
        if not self.kubectl.get(resource, namespace=_NS, output="name"):
            warn(
                "ExternalSecret devstash-secrets not found — cluster not reachable or ESO "
                "not installed"
            )
            warn("Run: devstash-infra gcp eso   (installs ESO + Reloader once per cluster)")
            return
        ready = self.kubectl.get(
            resource,
            namespace=_NS,
            output='jsonpath={.status.conditions[?(@.type=="Ready")].status}',
        )
        if ready == "True":
            ok("ESO ExternalSecret Ready=True — devstash-secrets K8s Secret is synced")
        else:
            warn(
                f"ESO ExternalSecret NOT Ready (status: {ready or 'unknown'}) — pods cannot start "
                "until sync completes"
            )
            describe = self.kubectl.describe(resource, namespace=_NS)
            if describe:
                typer.echo(describe)

    def rotate_secret(
        self,
        gcloud: Gcloud,
        *,
        name: str,
        value: str,
        clock: Callable[[], float] = time.monotonic,
    ) -> None:
        """Replace ONE property of devstash-app-config, then force ESO to sync now (rotate_secret).

        Ports `rotate_secret` (run.sh:1466). The name is validated against `ROTATABLE_SECRETS`
        (Terraform-owned generated secrets and settings.yaml config are not rotatable) and the value
        must be non-empty — both raise. `value` arrives already-resolved (the boundary reads it via
        `common.read_secret` so a credential never touches argv or shell history). Annotating the
        ExternalSecret with a fresh `force-sync` value tells ESO to re-sync now (skipping the 1h
        refresh); Reloader then rolls devstash-web automatically. `clock` is injected for tests.
        """
        if name not in ROTATABLE_SECRETS:
            raise InfraError(
                f"unsupported secret '{name}' — non-secret config lives in settings.yaml; "
                "generated database/Redis/GCS secrets rotate through OpenTofu"
            )
        if not value:
            raise InfraError("secret value must not be empty")
        self.use_cluster(message="cluster not reachable — run 'apply' first")

        log(f"Rotating property {name} inside devstash-app-config")
        blob = gcloud.secrets.access_blob(_APP_CONFIG_SECRET)
        if not blob:
            raise InfraError("devstash-app-config not found — run 'apply' first to create it")
        gcloud.secrets.add_version(_APP_CONFIG_SECRET, _with_property(blob, name, value))
        ok(f"Property {name} updated in devstash-app-config (new version)")

        log("Force ESO sync (skips the 1h refresh interval)")
        self.kubectl.annotate(
            f"externalsecret/{_EXTERNAL_SECRET}", "force-sync", str(clock()), namespace=_NS
        )
        ok("ESO sync triggered — Reloader will restart devstash-web once the Secret is updated")
        warn("Allow ~30s for ESO to pull from Secret Manager + Reloader to detect the change.")
        warn(
            f'Also update third_party_secrets["{name}"] in the gitignored terraform.tfvars so '
            "disaster recovery does not recreate the old value."
        )


# ── fail-fast parallel join [fix #11] ────────────────────────────────────────
@dataclass(frozen=True)
class Job:
    """One backgrounded job in a fail-fast join: an already-launched subprocess + a label. A ""
    label joins silently (the bare-pid back-compat path); a non-empty label announces
    "✓ [label] done in <dur>" on finish.
    """

    process: subprocess.Popen[str]
    label: str = ""


def _kill_quietly(process: subprocess.Popen[str]) -> None:
    """SIGKILL a surviving sibling, ignoring an already-exited pid (gke.sh:44)."""
    if process.poll() is None:
        # already-gone pid → no-op, exactly like bash `kill` on a dead pid
        with contextlib.suppress(ProcessLookupError):
            process.kill()


def join_fail_fast(
    jobs: Sequence[Job],
    die_msg: str,
    *,
    t0: float | None = None,
    poll_interval: float = 0.02,
) -> None:
    """Fold N backgrounded jobs under one fail-fast join [fix #11] (gke.sh:_join_fail_fast).

    Returns once ALL jobs exit 0. The instant the FIRST exits non-zero it KILLS every still-running
    sibling (so nothing is left installing/creating detached) and raises `InfraError` with
    `die_msg`. An empty job set is a no-op success.

    The bash `wait -n -p` (learn WHICH pid finished each iteration) becomes a poll over
    `Popen.poll()`; killing the survivors' processes is the faithful, stronger form of the shell's
    `kill "$p"` — it terminates the detached work itself, not just an OS pid.

    Narration: a Job with a non-empty label prints "✓ [label] done in <dur>" as it lands, the
    duration measured from `t0` (the group's start — a monotonic timestamp); unlabeled jobs stay
    silent. `t0` defaults to the join's start (0 elapsed) when omitted.
    """
    start = t0 if t0 is not None else time.monotonic()
    pending = list(jobs)
    while pending:
        finished = _await_one(pending, poll_interval)
        rc = finished.process.returncode
        if rc != 0:
            for job in pending:
                if job is not finished:
                    _kill_quietly(job.process)
            raise InfraError(f"{die_msg} (a joined job exited {rc})")
        if finished.label:
            ok(f"[{finished.label}] done in {fmt_dur(time.monotonic() - start)}")
        pending.remove(finished)


def _await_one(pending: Sequence[Job], poll_interval: float) -> Job:
    """Block until one pending job's process exits; return it (the `wait -n` analogue)."""
    while True:
        for job in pending:
            if job.process.poll() is not None:
                return job
        time.sleep(poll_interval)


# wait_for_cluster reachability window: ~15 min (90 × 10s) covers the deep-suspend DNS-endpoint
# propagation gap. Distinct from check-env-active's CLUSTER_WAIT_* (that polls LISTABILITY as a
# suspended-vs-active decision; this polls kubectl REACHABILITY) so overriding one never moves the
# other — the gcp boundary reads CLUSTER_REACHABLE_WAIT_* and passes them here.
_REACHABLE_ATTEMPTS = 90
_REACHABLE_GAP_S = 10.0


def wait_for_cluster(
    kubectl: Kubectl,
    gcloud: Gcloud,
    *,
    cluster: str,
    region: str,
    attempts: int = _REACHABLE_ATTEMPTS,
    gap_s: float = _REACHABLE_GAP_S,
    sleep: Callable[[float], None] = time.sleep,
) -> None:
    """Block until the GKE control plane answers kubectl, or raise — the #11 reachability wait.

    Three failure shapes, deliberately DISTINCT so the resume driver handles CI cancellation right:
      • cluster genuinely ABSENT (fast-fail pre-gate) — a real fault → `InfraError` (CI trap armed).
      • TEARDOWN in flight (another actor deleting it) — a real fault → `InfraError` (trap armed).
      • reachability TIMEOUT (cluster exists, endpoint still propagating) → `ClusterUnreachable`,
        so resume clears the trap first and leaves the pre-dispatched deploy running.

    An empty `cluster` (tofu output unavailable) skips the existence/teardown checks and lets the
    reachability poll be the sole oracle, exactly as the shell did. Not built on `poll_until`: that
    helper swallows a predicate exception into a timeout, which would mask the teardown fast-abort —
    so this is an explicit loop with an injected `sleep`, mirroring `check_env_active`.
    """
    # Fast-fail pre-gate: a CONFIRMED-absent cluster is a real fault — don't burn the window on it.
    # A transient gcloud error is TOLERATED (treat as maybe-present and wait); only a clean
    # not-listable result fails, matching the shell's `2>/dev/null` tolerance on the pre-gate.
    if cluster:
        try:
            listable = gcloud.container.cluster_listed(cluster, region=region)
        except proc.ProcError:
            listable = True
        if not listable:
            raise InfraError(
                f"GKE cluster '{cluster}' is not listable in {region} — it does not exist "
                "(apply never created it, or it was deleted); a real fault, not the reachable gap",
                hint="check the GCP console and re-run apply/resume",
            )

    log(
        "Waiting for the GKE control plane to become reachable "
        "(fresh apply ~5-7 min; a deep-suspend resume can take longer as the DNS endpoint settles)"
    )
    for attempt in range(1, attempts + 1):
        # Teardown check FIRST every iteration (before the first kubectl probe) — a teardown already
        # in flight aborts NOW instead of waiting out the window against a vanishing cluster.
        if cluster and gcloud.container.teardown_in_progress(cluster, region=region):
            raise InfraError(
                f"GKE cluster '{cluster}' is being TORN DOWN (STOPPING/ERROR, or a DELETE_CLUSTER "
                "op is in flight) — another actor ran down/suspend against this env mid-bring-up. "
                "Aborting: the endpoint will never answer (the cluster is going away); re-run "
                "resume once the teardown settles"
            )
        if kubectl.cluster_info():
            ok("cluster reachable")
            return
        if attempt < attempts:
            log(
                f"control plane not reachable yet (attempt {attempt}/{attempts}) — waiting {gap_s}s"
            )
            sleep(gap_s)

    minutes = round(attempts * gap_s / 60)
    raise ClusterUnreachable(
        f"cluster '{cluster}' not reachable after ~{minutes} minutes — it is RUNNING but the "
        "control-plane endpoint never answered kubectl (the deep-suspend DNS-endpoint gap)",
        hint="re-run resume, or raise CLUSTER_REACHABLE_WAIT_ATTEMPTS if it stays unreachable",
    )
