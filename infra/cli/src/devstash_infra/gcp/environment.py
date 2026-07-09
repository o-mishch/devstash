"""gcp/environment.py — the GCP deploy Environment: config + typed clients + lifecycle methods.

CLI zone (3.14). This is the domain object the re-architecture centres on: it holds the immutable
`GcpConfig` plus the typed clients (`Tofu`, `Gcloud`, `Kubectl`) and exposes the deploy lifecycle
as METHODS (`apply_plan`, `apply_exec`, `apply` — with `suspend`/`resume`/`up`/`down` landing as
their orchestrators port). Dense sub-domains become injected COLLABORATORS it constructs from its
own config + clients (`Reconcile` for drift-healing, `Gke` for cluster targeting), rather than free
functions threading `env` + a grab-bag of callables.

Failures RAISE (`InfraError` subtypes / `ProcError`) — never `sys.exit` mid-stack — and are mapped
once at the CLI boundary (`runtime.guard`).

The load-bearing incident fix here is **#9 (IAM propagation cooldown)**: a successful apply that
touched project IAM is NOT immediately read-consistent (GCP's IAM read path lags the write by
~1-2 min). `apply_exec` therefore HOLDS the provisioning marker for `IAM_PROPAGATION_COOLDOWN_S`
PAST the apply's own completion before releasing it — so the auto-suspend guard cannot greenlight a
suspend into the propagation gap (the exact race that 403'd a real suspend build mid-IAM-write,
stranding it before its cleanup steps).
"""

from collections.abc import Callable
from dataclasses import dataclass
from pathlib import Path

from devstash_infra.clients.gcloud import Gcloud
from devstash_infra.clients.helm import Helm
from devstash_infra.clients.kubectl import Kubectl
from devstash_infra.clients.tofu import Tofu
from devstash_infra.common import confirm, log
from devstash_infra.gcp.config import GcpConfig
from devstash_infra.gcp.gke import Gke
from devstash_infra.gcp.reconcile import Reconcile
from devstash_infra.shared.clock import SYSTEM_CLOCK, Clock
from devstash_infra.shared.dump import prune_dump_versions
from devstash_infra.shared.errors import Aborted, PlanRejected
from devstash_infra.shared.proc import ProcError

# `GcpConfig` moved to config.py (a leaf module) to break the Environment↔collaborators import
# cycle; re-exported here since it is a first-class part of this module's public surface.
__all__ = ["ApplyDeps", "Environment", "GcpConfig"]

# run.sh script constants (run.sh:133-142) — literals there, module constants here.
STATE_KEEP_VERSIONS = 3
STATE_PREFIX = "gke/dev/"
IAM_PROPAGATION_COOLDOWN_S = 120
PLAN_FILE = "devstash.tfplan"
STAGING_PLAN_FILE = "devstash-staging.tfplan"


@dataclass(frozen=True)
class ApplyDeps:
    """The not-yet-ported run.sh-core helpers `apply_plan` calls, injected for testability.

    `ensure_tfvars` writes the gitignored tfvars; `require_state_bucket` asserts the backend bucket
    exists (bootstrap ran); `wait_for_no_autosuspend_build` serialises against the scheduled idle
    auto-suspend build (they share one lock). `ar_iam_addr_file` is the ar-iam-member-addresses.txt
    path `Reconcile` reads. All land for real with gcp/app.
    """

    ensure_tfvars: Callable[[], None]
    require_state_bucket: Callable[[], None]
    wait_for_no_autosuspend_build: Callable[[], None]
    ar_iam_addr_file: str


class Environment:
    """A GCP deploy environment: config + typed clients, with lifecycle methods.

    The injected `clock` drives timed behaviors — the #9 IAM cooldown — so tests assert them without
    a real wait. `Reconcile`/`Gke` collaborators are built on demand from this Environment's own
    config + clients.
    """

    def __init__(
        self,
        config: GcpConfig,
        *,
        tofu: Tofu,
        gcloud: Gcloud,
        kubectl: Kubectl | None = None,
        helm: Helm | None = None,
        clock: Clock = SYSTEM_CLOCK,
    ) -> None:
        self.config = config
        self.tofu = tofu
        self.gcloud = gcloud
        self.kubectl = kubectl if kubectl is not None else Kubectl()
        self.helm = helm if helm is not None else Helm()
        self.clock = clock

    # ── collaborators (built from this Environment's config + clients) ────────
    def _reconcile(self, *, auto_approve: bool) -> Reconcile:
        return Reconcile(self.config, self.gcloud, self.tofu, auto_approve=auto_approve)

    def _gke(self) -> Gke:
        return Gke(self.config, self.tofu, self.kubectl, self.helm)

    # ── provisioning marker ──────────────────────────────────────────────────
    @property
    def _marker_uri(self) -> str:
        return f"gs://{self.config.state_bucket}/{STATE_PREFIX}.provisioning"

    def _mark_provisioning(self) -> None:
        """Write the provisioning marker (best-effort — the client swallows a transient error)."""
        self.gcloud.storage.write_marker(self._marker_uri)

    def _clear_provisioning(self) -> None:
        """Release the provisioning marker (best-effort)."""
        self.gcloud.storage.remove_marker(self._marker_uri)

    # ── plan file ────────────────────────────────────────────────────────────
    def _plan_paths(self) -> tuple[Path, Path]:
        """The two spots a saved plan can land — cwd-relative and `-chdir`-resolved."""
        return Path(PLAN_FILE), Path(self.tofu.tf_dir) / PLAN_FILE

    def _clear_plan_file(self) -> None:
        for path in self._plan_paths():
            path.unlink(missing_ok=True)

    # ── plan (foreground: heal drift → plan-to-file → review gate + marker) ───
    def apply_plan(
        self, deps: ApplyDeps, *, auto_approve: bool = False, confirmed: bool = False
    ) -> None:
        """Init → heal drift → plan-to-file → interactive review gate. Ports run.sh `_apply_plan`.

        Always plans to `PLAN_FILE` so `apply_exec` applies EXACTLY the reviewed diff (a bare
        `tofu apply` would re-plan after confirmation, allowing drift between review and mutation).
        `confirmed=True` (the overlapped bring-up paths already took one upfront `y`) prints the
        plan but skips the re-prompt. Raises `PlanRejected` on a plan failure and `Aborted` on a
        declined gate — clearing the plan file + marker first so no stale plan or stuck marker
        survives (no GCP mutation happened on either path).
        """
        deps.ensure_tfvars()
        self._clear_plan_file()  # never apply a stale plan — always regenerate a fresh one below
        deps.require_state_bucket()
        # Serialise against the scheduled idle auto-suspend build BEFORE touching state (shared
        # lock); mark provisioning only AFTER that clears (closes the marker-clear/lock-acquire
        # race).
        deps.wait_for_no_autosuspend_build()
        self._mark_provisioning()

        log(f"OpenTofu init + plan ({self.tofu.tf_dir})")
        self.tofu.init(self.config.state_bucket)
        # Heal state↔cloud drift a plain plan can't (untracked DB → import; legacy PSC subnet →
        # -replace); returns any -replace targets to fold into THIS plan so they're reviewed first.
        replace = self._reconcile(auto_approve=auto_approve).run(deps.ar_iam_addr_file)

        try:
            # The client's plan() carries the #7 refresh-time-404 fallback and the lock-aware
            # runner internally — the old explicit _plan_with_refresh_fallback seam is gone.
            self.tofu.plan(out=PLAN_FILE, lock_timeout="120s", replace=replace)
        except ProcError as exc:
            self._clear_plan_file()
            self._clear_provisioning()
            raise PlanRejected("OpenTofu plan failed") from exc

        if not confirmed and not confirm(
            "Apply this plan? (review the resource changes above)", auto_approve=auto_approve
        ):
            self._clear_plan_file()
            self._clear_provisioning()
            raise Aborted("aborted before apply")

    # ── exec (apply the saved plan + the IAM-cooldown tail [#9]) ──────────────
    def apply_exec(self) -> None:
        """Apply the saved plan, then hold the marker past the IAM cooldown [#9] (`_apply_exec`).

        Safe to background (resume overlaps it) — touches no kubeconfig. On any failure the marker
        is released immediately (no IAM landed durably) and the error propagates to the boundary;
        on success the state history is pruned, THEN the cooldown is held, THEN the marker released.
        """
        if not any(path.is_file() for path in self._plan_paths()):
            self._clear_provisioning()
            raise PlanRejected(
                f"saved plan '{PLAN_FILE}' is missing (expected at {self._plan_paths()[1]})",
                hint="No GCP mutation happened — re-run to regenerate and apply a fresh plan.",
            )

        try:
            self.tofu.apply(plan_file=PLAN_FILE, lock_timeout="120s")
        except ProcError:
            # Saved plans hold sensitive values; remove on failure too. No IAM landed durably on
            # this path, so release the marker immediately, then let the error reach the boundary.
            self._clear_plan_file()
            self._clear_provisioning()
            raise

        self._clear_plan_file()
        # Force state history down to STATE_KEEP_VERSIONS now, not on the bucket's ~daily sweep.
        prune_dump_versions(f"gs://{self.config.state_bucket}/{STATE_PREFIX}", STATE_KEEP_VERSIONS)
        log(
            f"Waiting {IAM_PROPAGATION_COOLDOWN_S}s for IAM propagation before releasing the "
            "provisioning marker"
        )
        self.clock.sleep(IAM_PROPAGATION_COOLDOWN_S)  # [#9] hold the marker PAST apply completion
        self._clear_provisioning()

    # ── the standard serial plan → apply → fetch-creds ───────────────────────
    def apply(
        self, deps: ApplyDeps, *, auto_approve: bool = False, confirmed: bool = False
    ) -> None:
        """The standard serial plan → apply → fetch-creds (up / suspend / dispatch). Ports `apply`.

        resume instead drives `apply_plan` and `apply_exec` apart to overlap the apply tail — that
        overlap driver lands with the app/ci phase (its #11 fail-fast join primitive is already in
        `gcp/gke.py`).
        """
        self.apply_plan(deps, auto_approve=auto_approve, confirmed=confirmed)
        self.apply_exec()
        log("Fetching kubectl credentials")
        self._gke().use_cluster_soft(
            message="no cluster (environment suspended) — skipping kubectl credential fetch"
        )

    # ── staging apply (targeted pre-apply subgraph for the overlap bring-up paths) ─
    def _staging_plan_paths(self) -> tuple[Path, Path]:
        return Path(STAGING_PLAN_FILE), Path(self.tofu.tf_dir) / STAGING_PLAN_FILE

    def _clear_staging_plan(self) -> None:
        for path in self._staging_plan_paths():
            path.unlink(missing_ok=True)

    def staging_apply(
        self,
        deps: ApplyDeps,
        *,
        label: str,
        targets: list[str],
        auto_approve: bool = False,
    ) -> None:
        """Plan a small `-target` subgraph to a file, then apply THAT file. Ports `_staging_apply`.

        The overlap bring-up paths front-load exactly the WIF/deployer-SA/AR-repo singletons ~1 min
        BEFORE the main apply so CI's build can start while Cloud SQL provisions. Unlike a blind
        `apply -auto-approve <targets>`, this PLANS to a file, shows that plan, then applies THAT
        EXACT file — so the staging diff is visible (the plan-first guarantee). The one upfront
        consent already came from the bring-up confirmation, so this does NOT prompt again.

        It reconciles state↔cloud drift BEFORE the targeted plan: the subgraph front-loads the
        globally-unique singletons a partial teardown most often strands (WIF pool + AR repo). Left
        live in GCP but dropped from state, a bare plan tries to CREATE them and the apply dies with
        a 409 "already exists"; reconcile adopts/undeletes them first. Its `-replace` targets (only
        the PSC subnet, never in this subgraph) are deliberately NOT folded into the `-target` plan,
        so reconcile runs here for its adopt/undelete side-effect only. No provisioning marker —
        the marker spans the FULL apply that follows (`apply_plan`), which reconciles the
        complete graph.
        """
        deps.ensure_tfvars()
        deps.require_state_bucket()
        deps.wait_for_no_autosuspend_build()
        log(
            f"Staging apply: {label} — planning the pre-apply subgraph so its diff is shown "
            "before it mutates GCP"
        )
        self.tofu.init(self.config.state_bucket)
        self._reconcile(auto_approve=auto_approve).run(deps.ar_iam_addr_file)
        self._clear_staging_plan()
        if any("google_secret_manager_secret_version.app_config" in target for target in targets):
            # A targeted plan that creates/replaces the app_config version cannot yet read back the
            # SPECIFIC version its check block asserts on — the "known after apply" warning is
            # expected here and resolves on the next (full) apply.
            log(
                "Note: a 'check block assertion known after apply' warning for "
                "app_config_version_enabled is expected here — the version doesn't exist yet in "
                "this targeted plan; it validates on the next apply."
            )
        try:
            self.tofu.plan(targets=targets, lock_timeout="120s", out=STAGING_PLAN_FILE)
            log(
                f"Staging plan for '{label}' shown above — applying it now "
                "(already authorised by the bring-up confirmation)"
            )
            self.tofu.apply(plan_file=STAGING_PLAN_FILE, lock_timeout="120s")
        except ProcError:
            # Saved plans hold sensitive values — remove on failure too, matching apply_plan/
            # apply_exec's clear-on-failure discipline; then let the error reach the boundary.
            self._clear_staging_plan()
            raise
        self._clear_staging_plan()
