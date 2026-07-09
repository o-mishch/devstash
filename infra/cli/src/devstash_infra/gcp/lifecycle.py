"""gcp/lifecycle.py — the environment bring-up / teardown orchestrators.

CLI zone (3.14). Ports run.sh's `up()` / `_apply_with_overlap()` / `_apply_and_wire()` + the two
staging pre-applies (`_apply_ci_identity` / `_apply_ar_push_target` + `_wait_ar_push_ready`), plus
suspend.sh's `suspend()` / `resume()` / `_apply_and_wire_cluster_overlapped()`. A `Lifecycle`
collaborator that threads the already-ported pieces: `Environment` (apply lifecycle +
`staging_apply`), `Deploy` (the CI-overlap driver: predispatch → cancel-on-error → watch),
`Secrets` (the GitHub push), `Dns` (the A-record), `Bootstrap` (up's prerequisites), `Db` (the
dump/restore [#4/#5]) and `Teardown` (the NEG reap).

THE OVERLAP, in one sentence: the deploy-gke build-push job authenticates via WIF/AR and has NO
dependency on Cloud SQL, so we apply JUST the WIF/deployer-SA/AR-repo subgraph first (~1 min), push
the GitHub secrets, DISPATCH the build, then run the full apply in parallel with it — instead of
leaving `deploy` a serial manual step behind the whole provision. `cancel_run_on_error` reaps the
orphaned build if the apply dies before the hand-off; a `ClusterUnreachable` timeout is spared (the
build's own waits may still carry it home). `resume` wraps its phases in a `span` for timed
narration; `suspend` dumps+verifies the DB [#4] BEFORE the destroying apply.
"""

from collections.abc import Callable
from concurrent.futures import FIRST_EXCEPTION, ThreadPoolExecutor
from concurrent.futures import wait as futures_wait
from contextlib import AbstractContextManager
from typing import Protocol

from devstash_infra.clients.ar import ArtifactRegistry
from devstash_infra.clients.gcloud import Gcloud
from devstash_infra.clients.kubectl import Kubectl
from devstash_infra.common import confirm, log, ok, span, stage, warn
from devstash_infra.gcp.config import GcpConfig
from devstash_infra.gcp.db import DumpTarget
from devstash_infra.gcp.environment import ApplyDeps
from devstash_infra.gcp.gke import wait_for_cluster
from devstash_infra.gcp.secrets import SECRETS_REQUIRED_OUTPUTS
from devstash_infra.gcp.teardown import set_active_state
from devstash_infra.models.tofu import TofuOutputs
from devstash_infra.shared.errors import Aborted

# resume's narration span declares 6 stages (suspend.sh:247) — kept at the shell's literal count so
# the `[stage N/6]` banners read byte-for-byte the same, even though 5 stage() calls are emitted.
_RESUME_SPAN_STAGES = 6

# The AR push target both staging pre-applies need: the repo the image is pushed to + the deployer's
# repo-scoped repoAdmin binding that authorizes the push (both count=environment_active — destroyed
# on suspend, recreated here). run.sh:_AR_PUSH_TARGET_ARGS.
AR_PUSH_TARGETS = (
    "module.artifact_registry.google_artifact_registry_repository.docker",
    "module.iam.google_artifact_registry_repository_iam_member.deployer_artifact_registry",
)

# The full CI-auth identity subgraph the post-down / first-ever path needs (the AR push target PLUS
# the WIF pool/provider + deployer & lifecycle SAs + their principalSet bindings + the app-config
# secret version). run.sh:_apply_ci_identity. Every one references only string literals +
# var.project_id/github_*/region/labels — ZERO cloudsql/gke/memorystore — so this stays a ~1-min
# subgraph. KEEP IN SYNC WITH SECRETS_REQUIRED_OUTPUTS: every output that gate checks must have its
# backing resource targeted here, or the first-ever path loops (staging "succeeds" with no changes
# but `_tf_outputs_present` still fails on the untargeted output).
CI_IDENTITY_TARGETS = (
    "module.iam.google_iam_workload_identity_pool.github",
    "module.iam.google_iam_workload_identity_pool_provider.github",
    "module.iam.google_service_account.deployer",
    "module.iam.google_service_account_iam_member.github_wif",
    "module.iam.google_service_account.lifecycle_deployer",
    "module.iam.google_service_account_iam_member.lifecycle_deployer_github_wif",
    "module.iam.google_secret_manager_secret_version.app_config",
    *AR_PUSH_TARGETS,
)


class ArWritable(Protocol):
    """The AR-writability probe surface `wait_ar_push_ready` needs, as a context manager.

    `ArtifactRegistry` satisfies it structurally; tests inject a fake so no httpx/GCP call runs.
    """

    def __enter__(self) -> ArWritable: ...
    def __exit__(self, *exc: object) -> None: ...
    def wait_until_writable(self) -> bool: ...


# ── consumer-owned collaborator seams (ISP) ──────────────────────────────────
# Narrow structural interfaces for the collaborators Lifecycle drives — only the methods/attributes
# it actually touches. The concrete `Environment`/`Deploy`/… classes satisfy them by shape, so the
# orchestration tests inject PLAIN fakes (no subclassing, no `# type: ignore`). `env.gcloud`/
# `env.kubectl`/`env.config` stay concrete because they flow into `wait_for_cluster` /
# `ArtifactRegistry` which need the real types; only `env.tofu` narrows (outputs + `tf_dir`).
class _Tofu(Protocol):
    """The `Tofu` surface Lifecycle reads off the environment — outputs + the chdir path."""

    @property
    def tf_dir(self) -> str: ...
    def output_json(self) -> TofuOutputs: ...


class _Environment(Protocol):
    """The `Environment` surface Lifecycle orchestrates — apply lifecycle + the clients it forwards.

    `tofu` is a read-only property (covariant) so the real `Environment`, whose `.tofu` is the wider
    concrete `Tofu`, satisfies the narrowed `_Tofu` seam; `config`/`gcloud`/`kubectl` are the exact
    concrete types Lifecycle forwards to `wait_for_cluster` / `ArtifactRegistry`.
    """

    config: GcpConfig
    gcloud: Gcloud
    kubectl: Kubectl

    @property
    def tofu(self) -> _Tofu: ...
    def apply(
        self, deps: ApplyDeps, *, auto_approve: bool = False, confirmed: bool = False
    ) -> None: ...
    def apply_plan(
        self, deps: ApplyDeps, *, auto_approve: bool = False, confirmed: bool = False
    ) -> None: ...
    def apply_exec(self) -> None: ...
    def staging_apply(
        self, deps: ApplyDeps, *, label: str, targets: list[str], auto_approve: bool = False
    ) -> None: ...


class _Deploy(Protocol):
    """The CI-overlap driver surface: pre-dispatch, the cancel trap, the hint, and the watch."""

    def predispatch(self, push_secrets: Callable[[], None]) -> str: ...
    def cancel_run_on_error(self, run_id: str, phase: str) -> AbstractContextManager[None]: ...
    def print_parallel_hint(self, infra_word: str, run_id: str) -> None: ...
    def watch_run(self, run_id: str) -> None: ...


class _Secrets(Protocol):
    """The GitHub-Actions push Lifecycle triggers before a deploy dispatch."""

    def push(self) -> None: ...


class _Dns(Protocol):
    """The A-record wiring Lifecycle runs after the cluster is reachable."""

    def dns_hint(self) -> None: ...
    def update(
        self, *, ingress_ip_override: str = "", key_override: str = "", secret_override: str = ""
    ) -> None: ...


class _Bootstrap(Protocol):
    """The first-ever prerequisite provisioning Lifecycle runs before `up`'s apply."""

    def run(self, *, auto_approve: bool = False) -> None: ...


class _Db(Protocol):
    """The dump/restore [#4/#5] surface Lifecycle threads through suspend/resume."""

    def dump(self) -> None: ...
    def resolve_dump_target(self) -> DumpTarget | None: ...
    def db_already_live(self, target: DumpTarget | None) -> bool: ...
    def restore(self, target: DumpTarget | None, *, was_already_live: bool = False) -> None: ...


class _Teardown(Protocol):
    """The best-effort NEG reap Lifecycle runs on the suspend path."""

    def cleanup_leaked_negs(self) -> None: ...


class Lifecycle:
    """The overlapped bring-up orchestrators over the ported collaborators.

    `wait_cluster` (the #11 reachability wait) and `make_ar` (the #12 AR-writable probe) are seams:
    they default to real implementations built from the Environment's clients + config, and tests
    inject fakes so no real polling/HTTP happens. `auto_approve` threads AUTO_APPROVE through the
    confirm gates.
    """

    def __init__(
        self,
        env: _Environment,
        deps: ApplyDeps,
        *,
        deploy: _Deploy,
        secrets: _Secrets,
        dns: _Dns,
        bootstrap: _Bootstrap,
        db: _Db,
        teardown: _Teardown,
        cleanup_builds: Callable[[], None] | None = None,
        wait_cluster: Callable[[], None] | None = None,
        make_ar: Callable[[str], ArWritable] | None = None,
        auto_approve: bool = False,
    ) -> None:
        self.env = env
        self.deps = deps
        self.deploy = deploy
        self.secrets = secrets
        self.dns = dns
        self.bootstrap = bootstrap
        self.db = db
        self.teardown = teardown
        # The in-flight-build cancel + staging-bucket reclaim shares the deferred
        # `wait_for_no_autosuspend_build` build machinery; the app boundary wires the real one. It
        # is best-effort (off the destroy path), so the default is a no-op until then.
        self._cleanup_builds = cleanup_builds or (lambda: None)
        self._wait_cluster = wait_cluster or self._default_wait_cluster
        self._make_ar = make_ar or self._default_make_ar
        self.auto_approve = auto_approve

    # ── production seams (overridden in tests) ───────────────────────────────
    def _default_wait_cluster(self) -> None:
        cluster = self.env.tofu.output_json().value("gke_cluster_name")
        wait_for_cluster(
            self.env.kubectl,
            self.env.gcloud,
            cluster=cluster,
            region=self.env.config.region,
        )

    def _default_make_ar(self, repo: str) -> ArWritable:
        return ArtifactRegistry(self.env.config.region, self.env.config.project, repo)

    # ── gates & predicates ───────────────────────────────────────────────────
    def _tf_outputs_present(self) -> bool:
        """True iff EVERY output `secrets` reads exists + is non-empty. Ports `_tf_outputs_present`.

        The real precondition for pre-dispatching CI BEFORE apply: the overlap only works when those
        outputs already exist (they DO after a `suspend`, NOT after a `down`/first-ever). Gating on
        the OUTPUTS — not on stale GitHub secrets, which can outlive a `down` that erased them — is
        the only correct check. A tofu read hiccup yields `{}` → not present → the safe serial path.
        """
        return not self.env.tofu.output_json().missing(*SECRETS_REQUIRED_OUTPUTS)

    def _confirm_bringup(self, phase: str) -> None:
        """The SINGLE upfront intent gate for the overlapped bring-up paths (`_confirm_bringup`).

        Those paths deliberately FRONT-LOAD GCP mutation (a staging apply + a real CI dispatch) so
        the ~1-min identity/AR create and the image build overlap the ~10-min Cloud SQL create. This
        gate makes all of that wait for ONE explicit `y` — without it a resume/up/apply creates
        AR/SAs/WIF and dispatches a build before the operator ever sees a plan. On decline we raise
        `Aborted` before ANY mutation. On accept the caller passes `confirmed=True` down so the
        later plan review does not prompt a second time (exactly one interactive confirm per run).
        """
        log(f"'{phase}' will provision GCP. It runs, IN THIS ORDER, once you confirm:")
        log(
            "  1. a staging apply: WIF pool/provider, deployer + lifecycle SAs + IAM bindings, "
            "Artifact Registry repo + push binding"
        )
        log(
            "  2. push GitHub Actions secrets, then DISPATCH the deploy-gke CI run "
            "(builds + pushes images)"
        )
        log(
            "  3. the full 'tofu apply': Cloud SQL, GKE, Memorystore, Cloud NAT/Armor, ingress IP "
            "— the reviewed plan is printed before it applies"
        )
        warn(
            "Steps 1-2 begin creating GCP resources IMMEDIATELY after you confirm — there is no "
            "separate prompt before them."
        )
        if not confirm(
            f"Proceed with '{phase}'? (nothing has touched GCP yet)", auto_approve=self.auto_approve
        ):
            raise Aborted("aborted before any GCP changes")

    # ── staging pre-applies (front-load the CI-auth/AR subgraph, then gate on writability) ─
    def wait_ar_push_ready(self) -> None:
        """Block until the deployer SA can ACTUALLY push to the AR repo (`_wait_ar_push_ready`).

        The staging apply returns once the repo's SetIamPolicy succeeds, but a residual
        IAM→registry-data-plane propagation lag follows (build-push's own `ds_ar_writable` poll
        would otherwise burn minutes on it, and its wrapping step-retry can time out first). Moving
        the wait HERE (onto run.sh's clock, which has no build-step timeout) means CI is dispatched
        only once the push identity is genuinely usable. A timeout is a non-fatal warn (the binding
        already exists in state; let CI's own poll ride out any remaining lag). The repo id comes
        from the tofu output (one source of truth, shared with CI's REPO), empty → skip the gate.
        """
        repo = self.env.tofu.output_json().value("artifact_registry_repository_id")
        if not repo:
            warn(
                "artifact_registry_repository_id output empty — skipping the AR-writable dispatch "
                "gate; CI's own ds_ar_writable poll will cover it"
            )
            return
        log(
            f"Confirming the deployer SA can push to Artifact Registry '{repo}' before dispatching "
            "CI (covers IAM→registry propagation)"
        )
        with self._make_ar(repo) as ar:
            writable = ar.wait_until_writable()
        if writable:
            ok(f"Artifact Registry '{repo}' is writable by the deployer SA — dispatching CI")
        else:
            warn(
                f"Artifact Registry '{repo}' still not writable after the AR-writable wait — "
                "dispatching CI anyway; its ds_ar_writable poll rides out the residual propagation"
            )

    def apply_ci_identity(self) -> None:
        """Apply the CI-auth identity subgraph, post-down / first-ever (`_apply_ci_identity`)."""
        self.env.staging_apply(
            self.deps,
            label=(
                "CI auth identity + AR push target + app-config secret "
                "(WIF + deployer SA + repo/binding + secret version)"
            ),
            targets=list(CI_IDENTITY_TARGETS),
            auto_approve=self.auto_approve,
        )
        self.wait_ar_push_ready()

    def apply_ar_push_target(self) -> None:
        """Recreate the AR repo + deployer push binding, post-suspend (`_apply_ar_push_target`)."""
        self.env.staging_apply(
            self.deps,
            label="Artifact Registry repo + deployer push binding",
            targets=list(AR_PUSH_TARGETS),
            auto_approve=self.auto_approve,
        )
        self.wait_ar_push_ready()

    # ── apply tails ──────────────────────────────────────────────────────────
    def _wire_cluster_and_secrets(self) -> None:
        """Wait for the cluster ‖ push GitHub secrets, concurrently. Ports `_apply_and_wire`'s join.

        `wait_for_cluster` (kubectl/gcloud polling) and `secrets.push` (gh, no cluster dependency)
        touch disjoint subsystems, so run them concurrently instead of serializing the push behind
        the cluster wait. FAIL-FAST like the shell (`secrets` foreground under `set -e`): the moment
        EITHER task raises we surface it, instead of blocking on the up-to-15-min cluster wait when
        a fast `secrets.push` failure (e.g. de-authenticated `gh`) already doomed the bring-up. A
        `ClusterUnreachable` keeps its type on re-raise so `cancel_run_on_error` spares the run.
        """
        tasks: dict[str, Callable[[], None]] = {
            "cluster": self._wait_cluster,
            "secrets": self.secrets.push,
        }
        pool = ThreadPoolExecutor(max_workers=len(tasks))
        try:
            futures = [pool.submit(fn) for fn in tasks.values()]
            done, _ = futures_wait(futures, return_when=FIRST_EXCEPTION)
            for future in done:
                exc = future.exception()
                if exc is not None:
                    raise exc
        finally:
            # On a fail-fast raise, don't block on the survivor's remaining cluster-wait window;
            # a bounded wait_for_cluster can't be interrupted mid-flight, but this stops us joining
            # its full budget just to re-raise a failure we already have.
            pool.shutdown(wait=False, cancel_futures=True)

    def apply_and_wire(self) -> None:
        """The standard post-bootstrap bring-up tail. Ports `_apply_and_wire`.

        apply → (wait-for-cluster ‖ secrets) → print + assert DNS. Single-sourced so the `apply`
        dispatch and up()'s first-ever branch never drift. NO local ESO/Reloader install: every
        caller pre-dispatches the deploy first, and that CI job installs the operators before its
        own apply-infra — a local install here would race CI's against the same Helm release.
        """
        self.env.apply(self.deps, auto_approve=self.auto_approve, confirmed=True)
        self._wire_cluster_and_secrets()
        self._dns_tail()

    def _dns_tail(self) -> None:
        """Print the post-apply DNS guidance, then assert the A-record.

        Shared so the `apply`/`up` present-branch and `apply_and_wire`'s tail never drift on the
        hint+update pair.
        """
        self.dns.dns_hint()
        self.dns.update()

    # ── dispatch commands ────────────────────────────────────────────────────
    def apply_with_overlap(self) -> None:
        """The `apply` command's tail: overlap the build with apply. Ports `_apply_with_overlap`.

        Outputs present (re-apply / config tweak) → pre-dispatch the build so it overlaps apply.
        Outputs absent (first-ever) → apply the WIF identity first (~1 min, Cloud-SQL-free), then
        pre-dispatch and overlap the full apply. Unlike resume, this does NOT block on the run: an
        `apply` returns as soon as infra is wired and prints `gh run watch <id>` for the background
        build. The cancel trap still reaps the run if apply dies before the hand-off.
        """
        self._confirm_bringup("apply")
        if self._tf_outputs_present():
            log("Tofu outputs present — pre-dispatching deploy so its build overlaps apply")
        else:
            log(
                "No tofu outputs (first-ever apply) — "
                "applying WIF identity first so the build overlaps apply"
            )
            self.apply_ci_identity()
        run_id = self.deploy.predispatch(self.secrets.push)
        with self.deploy.cancel_run_on_error(run_id, "apply"):
            self.apply_and_wire()
        self.deploy.print_parallel_hint("applied", run_id)

    def up(self) -> None:
        """First-ever / post-down bring-up: bootstrap + provision + overlapped build. Ports `up()`.

        Runs `bootstrap` (project/billing/state/APIs — its own gate) then the same overlap as
        `apply`. Outputs present (an `up` re-run against a live env) → pre-dispatch, apply, wait for
        the cluster, then DNS. Outputs absent (first-ever / post-down) → WIF identity first, then
        the full overlapped tail. `preflight` (required-CLI check) is the typer boundary's job.
        """
        self.bootstrap.run(auto_approve=self.auto_approve)
        self._confirm_bringup("up")
        if self._tf_outputs_present():
            log("Tofu outputs present — pre-dispatching deploy so its build overlaps apply")
            run_id = self.deploy.predispatch(self.secrets.push)
            with self.deploy.cancel_run_on_error(run_id, "up"):
                self.env.apply(self.deps, auto_approve=self.auto_approve, confirmed=True)
                self._wait_cluster()
            self._dns_tail()
            self.deploy.print_parallel_hint("up", run_id)
            return
        log(
            "No tofu outputs (first-ever / post-down) — "
            "applying WIF identity first so the build overlaps apply"
        )
        self.apply_ci_identity()
        run_id = self.deploy.predispatch(self.secrets.push)
        with self.deploy.cancel_run_on_error(run_id, "up"):
            self.apply_and_wire()
        self.deploy.print_parallel_hint("up", run_id)
        ok("  (If the DNS A-record was not set automatically — creds missing — add it by hand.)")

    # ── suspend / resume ─────────────────────────────────────────────────────
    def suspend(self) -> None:
        """Deep-suspend the environment to ~$0. Ports suspend.sh's `suspend`.

        DUMPS Cloud SQL to GCS and VERIFIES the dump FIRST, then applies the destroys (GKE cluster,
        Memorystore, Cloud NAT/Armor, ingress IP AND the Cloud SQL instance — no kept disk). The
        data lives only in the verified GCS dump; `resume` restores it. The dump-and-verify happens
        BEFORE any destroy [fix #4], so a failed dump aborts the suspend with the instance intact.
        The apply keeps its normal review gate (the plan shows the destroys) — no bring-up confirm.
        """
        self.deps.ensure_tfvars()
        log(
            "Deep-suspending environment → ~$0 "
            "(compute + Cloud SQL DESTROYED; data kept in GCS dump)"
        )
        warn(
            "Cloud SQL is DUMPED to GCS and verified, then DESTROYED. "
            "'resume' recreates + restores it."
        )
        warn("DNS for the app domain will go stale until 'resume' (the ingress IP is released).")
        self.db.dump()  # [#4] export + verify BEFORE anything is destroyed — aborts on failure
        set_active_state(self.env.tofu.tf_dir, environment_active=False, db_active=False)
        self.env.apply(self.deps, auto_approve=self.auto_approve)  # plan shows the destroys
        self._cleanup_builds()  # cancel in-flight builds + reclaim the staging bucket (best-effort)
        self.teardown.cleanup_leaked_negs()  # reap NEGs GKE orphaned on cluster destroy
        ok("Suspended to ~$0 (data safe in the GCS dump). Run 'resume' to bring it back.")

    def _apply_and_wire_cluster_overlapped(self) -> None:
        """The resume bring-up core: apply → wait cluster → restore DB [#11 driver].

        Ports `_apply_and_wire_cluster_overlapped`. The CI build (pre-dispatched by the caller) runs
        in parallel with this whole apply. Within one apply OpenTofu builds module.gke and
        module.cloudsql as independent DAG branches, so the control plane is reachable well before
        Cloud SQL finishes — but apply does not RETURN until both do (~10 min). The
        `was_already_live`
        snapshot is taken BEFORE apply [#5]: a genuine post-suspend resume finds nothing (the apply
        recreates the instance), so `restore` imports; a resume re-run against an already-up env
        finds
        it and `restore` refuses to overwrite live data. The DB restore is SERIAL after the apply
        (Cloud SQL must be RUNNABLE). Foreground-sequential — the shell removed its local operator
        install (CI installs them), so nothing local is left to overlap the apply with here.
        """
        target = self.db.resolve_dump_target()
        was_already_live = self.db.db_already_live(target)  # [#5] snapshot BEFORE apply
        stage(
            "apply → applying (Cloud SQL ~10m + control plane), pre-dispatched CI build overlapping"
        )
        self.env.apply_plan(self.deps, auto_approve=self.auto_approve, confirmed=True)
        self.env.apply_exec()
        self._wait_cluster()  # control plane reachable mid-apply; raises on genuine fault
        stage("restore DB from GCS dump (Cloud SQL runnable now that apply finished)")
        self.db.restore(target, was_already_live=was_already_live)

    def resume(self) -> None:
        """Bring the environment back from deep-suspend. Ports suspend.sh's `resume`.

        Recreates compute AND Cloud SQL, RESTORES the DB from the latest GCS dump, and re-points DNS
        at the new ingress IP. Skips bootstrap (project/billing/state/APIs persist across suspend).
        Two entry states, gated on `_tf_outputs_present`: post-SUSPEND (outputs present) takes the
        FAST path — recreate JUST the AR repo/binding (identity survived) then pre-dispatch
        so the build overlaps apply; post-DOWN / first-ever (outputs absent) applies the full WIF
        identity first. Both then run the overlapped apply ‖ CI build, re-point DNS, and BLOCK on
        the
        CI run (a resume that only kicks CI off would hide a failed build behind a healthy cluster).
        """
        self.deps.ensure_tfvars()
        # Single upfront intent gate BEFORE the span — a decline raises with nothing to unwind.
        self._confirm_bringup("resume")
        with span(_RESUME_SPAN_STAGES):
            stage(
                "Resume start — recreate compute + Cloud SQL, restore the dump. "
                "Takes several minutes."
            )
            set_active_state(self.env.tofu.tf_dir, environment_active=True, db_active=True)

            present = self._tf_outputs_present()
            if present:
                log(
                    "Tofu outputs present (suspended env) — "
                    "pre-dispatching CI so its build overlaps apply"
                )
                self.apply_ar_push_target()  # identity survived; recreate the AR repo + binding
            else:
                warn(
                    "No tofu outputs (downed / first-ever env) — "
                    "applying WIF identity first so the build overlaps apply"
                )
                self.apply_ci_identity()  # full identity subgraph (post-down / first-ever)

            run_id = self.deploy.predispatch(self.secrets.push)
            # The cancel trap spans the overlapped apply AND the DNS re-point; a genuine fault reaps
            # the orphaned build; a `ClusterUnreachable` timeout leaves it running (its own waits
            # may
            # carry it home). `watch_run` takes ownership AFTER this block (no trap left to clear).
            with self.deploy.cancel_run_on_error(run_id, "resume"):
                self._apply_and_wire_cluster_overlapped()
                if present:
                    log(
                        "CI build+push ran in parallel with apply; "
                        "its cluster-gated deploy proceeds now"
                    )
                stage("re-point DNS at the new ingress IP")
                self.dns.update()
            stage(
                "watching CI deploy run "
                "(build+push overlapped apply; the cluster-gated deploy proceeds now)"
            )
            self.deploy.watch_run(run_id)
            ok(
                "HTTPS is live as soon as DNS propagates to the new IP — the Certificate Manager "
                "cert survived the suspend (no reprovision wait)."
            )
