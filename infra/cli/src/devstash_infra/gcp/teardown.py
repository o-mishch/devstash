"""gcp/teardown.py — the destructive teardown (`down`) family + its incident fixes.

CLI zone (3.14). Ports the `down()` path of run/gcp/lib/suspend.sh — the self-healing teardown
hardened after the live 2026-07-06 incident where a `down` reported "destroyed" while GKE actually
survived. Re-architected onto the Python-native paradigm: a `Teardown` COLLABORATOR over
`GcpConfig` + the typed `Gcloud`/`Tofu` clients. The old `LockedRun = Callable[..., Result]` seam
is GONE — the `Tofu` client is itself lock-aware (routes through `state_lock` with the injected
recovery), so each step just calls `self.tofu.<op>` and RAISES to the boundary; best-effort steps
catch `ProcError` and warn (the shell's `|| true`).

The suspend()/resume() orchestrators + the resume overlap driver depend on run.sh core steps
(apply/dump/dispatch) + gcp/dns and land with the app layer; the join primitive the overlap uses
is already in gcp/parallel.join_fail_fast [fix #11].

Incident fixes here:
  #3  down runs `tofu destroy` with ZERO `-exclude` flags (2+ silently no-op the whole plan on
      OpenTofu 1.12.3 — how GKE survived a "successful" down). The `Tofu.destroy` signature has no
      `exclude` param, so this is structural. The two prevent_destroy secrets are instead SHELVED
      out of state (`state rm`), destroyed, then re-imported.
  #8  the Memorystore PSC-detach 400 is retried ONLY after an operator confirms — never a silent
      auto-retry of a destructive command.
  #14 restore re-imports the NEWEST ENABLED secret version (via `gcloud.secrets.newest_version`),
      never a disabled/arbitrary one.
"""

import re
from dataclasses import dataclass
from pathlib import Path

from devstash_infra.clients.gcloud import Gcloud
from devstash_infra.clients.tofu import Tofu
from devstash_infra.common import confirm, log, ok, warn
from devstash_infra.gcp.config import GcpConfig
from devstash_infra.shared.clock import SYSTEM_CLOCK, Clock
from devstash_infra.shared.errors import Aborted, InfraError
from devstash_infra.shared.proc import ProcError

# The only two prevent_destroy resources in the env — shelved out of state for the destroy,
# re-imported after (fix #3). app_config + version + its IAM member live in module.iam;
# ops_config + its count-gated version are top-level. Keep in sync if a prevent_destroy is added.
_PROTECTED_SECRET_ADDRS = (
    "module.iam.google_secret_manager_secret.app_config",
    "module.iam.google_secret_manager_secret_version.app_config",
    "module.iam.google_secret_manager_secret_iam_member.app_access",
    "google_secret_manager_secret.ops_config",
    "google_secret_manager_secret_version.ops_config[0]",
)

# The two singletons a reconcile-time `tofu import` can leave with a state-recorded
# deletion_protection=true (import records the provider's live value, not config's false);
# Memorystore has no such Terraform attribute, so it is not checked.
_DELETION_PROTECTED_ADDRS = (
    "module.cloudsql.google_sql_database_instance.postgres[0]",
    "module.gke.google_container_cluster.primary[0]",
)

_DELETION_PROTECTION_RE = re.compile(r"^\s*deletion_protection\s*=\s*(true|false)", re.MULTILINE)
# The Memorystore PSC-detach lag: the service-connection-policy delete 400s for a few minutes
# after the instance destroy completes, while GCP finishes its own async connection detach.
_PSC_STILL_ATTACHED_RE = re.compile(
    r"ServiceConnectionPolicy.*still has [0-9]+ PSC Connection", re.IGNORECASE | re.DOTALL
)


def set_active_state(tf_dir: str, *, environment_active: bool, db_active: bool) -> None:
    """Persist the suspend/resume toggles to active.auto.tfvars (suspend.sh:35).

    Written together so environment_active (compute) and db_active (Cloud SQL) never drift. Makes
    the suspended/active state STICKY — a plain apply keeps it instead of reverting. A free function
    (not a Teardown method): it belongs to suspend/resume, which land with the app layer.
    """
    content = (
        f"environment_active = {str(environment_active).lower()}\n"
        f"db_active          = {str(db_active).lower()}\n"
    )
    (Path(tf_dir) / "active.auto.tfvars").write_text(content)


def psc_connections_still_attached(destroy_output: str) -> bool:
    """True iff `destroy_output` is the Memorystore PSC-detach lag error [fix #8]
    (suspend.sh:_psc_connections_still_attached) — the ONLY destroy failure eligible for retry.
    """
    return bool(_PSC_STILL_ATTACHED_RE.search(destroy_output))


@dataclass(frozen=True)
class Teardown:
    """The destructive `down` family over the typed clients.

    The injected `clock` drives the PSC-detach wait [#8], so tests assert it without a real pause.
    """

    config: GcpConfig
    gcloud: Gcloud
    tofu: Tofu
    clock: Clock = SYSTEM_CLOCK

    # ── deletion-protection drift correction ─────────────────────────────────
    def reconcile_deletion_protection(self) -> None:
        """Correct deletion_protection=true drift on the imported singletons before destroy
        (suspend.sh:_reconcile_deletion_protection). A targeted, config-driven apply — not raw
        state surgery. Best-effort per resource: a failed correction warns and lets the real
        destroy surface its own error. Absent-from-state → a clean skip (state show empty).
        """
        for addr in _DELETION_PROTECTED_ADDRS:
            text = self.tofu.state_show(addr)
            if not text:
                continue  # absent from state → nothing to correct
            match = _DELETION_PROTECTION_RE.search(text)
            if not match or match.group(1) != "true":
                continue
            warn(
                f"Reconcile: {addr} has deletion_protection=true in state (config says false) "
                "— correcting before destroy"
            )
            try:
                self.tofu.apply(auto_approve=True, refresh=False, targets=(addr,))
            except ProcError:
                warn(
                    f"could not pre-correct deletion_protection on {addr} — the destroy below "
                    "may fail on it"
                )

    # ── shelve / restore the prevent_destroy secrets [fix #3] ────────────────
    def shelve_protected_secrets(self) -> None:
        """`state rm` each present prevent_destroy secret so destroy can run with ZERO `-exclude`
        flags [fix #3] (suspend.sh:_shelve_protected_secrets). GCP objects are never touched (state
        rm only). Best-effort per address — a failed removal warns and continues.
        """
        for addr in _PROTECTED_SECRET_ADDRS:
            if not self.tofu.state_show(addr):
                continue  # absent → nothing to shelve
            log(f"Shelving {addr} out of state before destroy (GCP object untouched — state rm)")
            try:
                self.tofu.state_rm(addr)
            except ProcError:
                warn(
                    f"could not shelve {addr} out of state — the destroy below may hit its "
                    "prevent_destroy guard"
                )

    def _reimport_or_warn(self, addr: str, import_id: str, label: str) -> None:
        """`tofu import addr id`, warning with the EXACT manual command (rebuilt from the same
        addr+id) on failure so the hint can never drift (suspend.sh:_reimport_or_warn). Never
        raises out — the GCP object is already safe; only Terraform bookkeeping would be stale.
        """
        try:
            self.tofu.import_(addr, import_id)
        except ProcError:
            warn(f'could not re-import {label} — manual: tofu import {addr} "{import_id}"')

    def restore_protected_secrets(self) -> None:
        """Re-import the two secret containers + their newest ENABLED version [fix #14] +
        app_config's IAM member (suspend.sh:_restore_protected_secrets). Best-effort per resource.
        Runs even on a failed destroy so the secrets are never left unshelved.
        """
        project = self.config.project
        app_id, ops_id = "devstash-app-config", "devstash-ops-config"
        app_ver = self.gcloud.secrets.newest_version(app_id)
        ops_ver = self.gcloud.secrets.newest_version(ops_id)

        log("Restoring app_config + ops_config into Terraform state (GCP objects untouched)")
        self._reimport_or_warn(
            "module.iam.google_secret_manager_secret.app_config",
            f"{project}/{app_id}",
            "the app_config secret",
        )
        if app_ver:
            self._reimport_or_warn(
                "module.iam.google_secret_manager_secret_version.app_config",
                f"projects/{project}/secrets/{app_id}/versions/{app_ver}",
                "the app_config secret version",
            )
        else:
            warn(
                "app_config has no ENABLED version to re-import (unexpected — check gcloud secrets "
                f"versions list {app_id})"
            )

        app_sa = self.tofu.output_json().value("app_service_account_email")
        if app_sa:
            self._reimport_or_warn(
                "module.iam.google_secret_manager_secret_iam_member.app_access",
                f"projects/{project}/secrets/{app_id} roles/secretmanager.secretAccessor "
                f"serviceAccount:{app_sa}",
                "the app_access IAM binding",
            )
        else:
            warn(
                "no app_service_account_email output yet (post-down, expected until the next "
                "apply) — app_access IAM-member re-import deferred to that apply"
            )

        self._reimport_or_warn(
            "google_secret_manager_secret.ops_config",
            f"{project}/{ops_id}",
            "the ops_config secret",
        )
        if ops_ver:
            self._reimport_or_warn(
                "google_secret_manager_secret_version.ops_config[0]",
                f"projects/{project}/secrets/{ops_id}/versions/{ops_ver}",
                "the ops_config secret version",
            )
        else:
            warn(
                "ops_config has no ENABLED version to re-import (fine if Spaceship DNS creds "
                "were never configured)"
            )

    # ── best-effort teardown helpers ─────────────────────────────────────────
    def reap_stranded_router(self) -> None:
        """Force-delete an out-of-band Cloud Router `down` finds in GCP but not in state
        (suspend.sh:_reap_stranded_router) — it blocks the VPC delete otherwise. Existence-gated (a
        normal down has no router here — 404 is the common case), best-effort on the delete.
        """
        router = f"devstash-{self.config.environment}-router"
        if not self.gcloud.compute.router_exists(router, region=self.config.region):
            return
        warn(
            f"Reconcile: Cloud Router '{router}' exists in GCP but is untracked in state — "
            "deleting it directly so the VPC delete isn't blocked"
        )
        try:
            self.gcloud.compute.delete_router(router, region=self.config.region)
        except ProcError:
            warn(f"could not delete stranded router {router} — the VPC destroy below may fail")

    def _vpc_exists(self) -> bool:
        """True iff this env's VPC still exists — a completed down already removed it."""
        return self.gcloud.compute.network_exists(f"devstash-{self.config.environment}-vpc")

    def empty_bucket(self, uri: str) -> None:
        """Recursively delete every object version in `uri` so the no-force_destroy guard can't
        block destroy (suspend.sh:empty_bucket). Best-effort — an absent/empty bucket is a no-op.
        """
        if not uri or not self.gcloud.storage.bucket_exists(uri):
            return
        log(f"Emptying {uri} (all object versions) so destroy can delete the bucket")
        try:
            self.gcloud.storage.empty_bucket(uri)
        except ProcError:
            warn(f"empty of {uri} returned non-zero (likely already empty) — continuing")

    def cleanup_leaked_negs(self) -> None:
        """Reap GKE-leaked NEGs + firewall rules on this env's VPC (suspend.sh:cleanup_leaked_negs).

        VPC-existence-gated (a completed down already removed it) so the `down` path — which runs
        this while the cluster may still be live — never reaps against a gone VPC.
        """
        if not self._vpc_exists():
            return
        self.gcloud.compute.reap_leaked_negs(f"devstash-{self.config.environment}-vpc")

    def force_release_psa(self) -> None:
        """Reclaim the ABANDONed PSA peering + reserved range GCP holds past the teardown
        (suspend.sh:force_release_psa). Both deletes are best-effort (the producer lock may hold the
        peering for up to ~4 days; the range 409s until it frees). VPC-existence-gated.
        """
        if not self._vpc_exists():
            return
        vpc = f"devstash-{self.config.environment}-vpc"
        psa_range = f"devstash-{self.config.environment}-psa"
        log(f"Force-releasing leftover PSA peering on {vpc} (ABANDONed on destroy; GCP holds it)")
        try:
            self.gcloud.services.delete_vpc_peering(vpc)
        except ProcError:
            warn(
                "PSA peering delete returned non-zero (GCP producer lock not yet released — it "
                "clears on its own, up to ~4 days) — continuing"
            )
        log(f"Releasing reserved PSA range {psa_range}")
        try:
            self.gcloud.compute.delete_global_address(psa_range)
        except ProcError:
            warn("PSA range delete returned non-zero (still held by the peering above) — skipping")

    # ── PSC-detach retry [fix #8] ────────────────────────────────────────────
    def handle_psc_destroy_block(self, *, auto_approve: bool) -> bool:
        """Interactive recovery for the PSC-detach lag [fix #8] (suspend.sh handler).

        NEVER a silent auto-retry: the only safe move is to wait for GCP's async cleanup and retry
        the SAME destroy — gated on an operator confirm. Returns True → caller should retry; False →
        give up and propagate. There is deliberately no force-delete lever.
        """
        warn(
            "The Memorystore PSC service-connection-policy still shows attached connections — this "
            "is usually GCP's own async cleanup lag right after the Memorystore instance destroy, "
            "not a real conflict."
        )
        warn(
            "There is no safe force-delete here: gcloud has no --force flag for this resource, and "
            "GCP's own docs warn against deleting the underlying PSC forwarding-rules/addresses "
            "directly (they are owned by Memorystore's lifecycle, not yours — doing so risks "
            "orphaned networking state)."
        )
        if confirm(
            "Wait ~60s for GCP's cleanup to catch up, then retry the destroy?",
            auto_approve=auto_approve,
        ):
            log("Waiting 60s for GCP to detach the lingering PSC connections...")
            self.clock.sleep(60)
            return True
        warn(
            "NOT RECOMMENDED by GCP: manually deleting the specific consumer forwarding-rules/"
            "addresses the destroy plan listed (shown above, under 'psc_connections') may unblock "
            "this, but can orphan networking state Memorystore no longer knows to clean up."
        )
        if confirm(
            "Skip the safe wait and delete those forwarding-rules/addresses directly anyway?",
            auto_approve=auto_approve,
        ):
            warn(
                "Not automated — the exact resource names are in the destroy output above "
                "(consumer_forwarding_rule / consumer_address)."
            )
            warn(
                f"Delete each with: gcloud compute forwarding-rules delete <name> "
                f"--region={self.config.region} --project={self.config.project}"
            )
            warn(
                f"                  gcloud compute addresses delete <name> "
                f"--region={self.config.region} --project={self.config.project}"
            )
            if confirm(
                "Have you deleted them and want to retry the destroy now?",
                auto_approve=auto_approve,
            ):
                return True
        return False

    def down_destroy_with_psc_retry(self, *, auto_approve: bool) -> None:
        """The real `tofu destroy` (NO `-exclude` [fix #3]) in a bounded, operator-confirmed retry
        loop for the one transient PSC-detach lag [fix #8] (suspend.sh destroy loop).
        The client streams the destroy output live; every OTHER failure restores the shelved secrets
        and raises — so a partial destroy never leaves them permanently untracked.
        """
        while True:
            try:
                self.tofu.destroy(auto_approve=True, refresh=False)
            except ProcError as exc:
                combined = f"{exc.result.stdout}\n{exc.result.stderr}"
                if psc_connections_still_attached(combined) and self.handle_psc_destroy_block(
                    auto_approve=auto_approve
                ):
                    log("Retrying the destroy...")
                    continue
                self.restore_protected_secrets()
                raise InfraError(
                    "tofu destroy failed — resolve the error above, then re-run 'down' (it is safe "
                    "to re-run; already-destroyed resources are skipped)"
                ) from exc
            else:
                return  # destroy succeeded — exit the PSC-retry loop

    # ── down orchestrator [fix #3] ───────────────────────────────────────────
    def down(self, *, auto_approve: bool = False) -> None:
        """FORCE-destroy the entire environment (suspend.sh:down). Empties both buckets, corrects
        deletion_protection drift, SHELVES the prevent_destroy secrets, destroys with ZERO
        `-exclude` [fix #3] under the PSC-retry loop [fix #8], reaps a stranded router, releases the
        ABANDONed PSA plumbing, then re-imports the secrets. State bucket + project stay intact.
        """
        self.tofu.init(self.config.state_bucket)
        log(f"FORCE tear down — tofu destroy ({self.tofu.tf_dir})")
        warn("This deletes the GKE cluster, Cloud SQL, and Memorystore.")
        warn("UNLIKE 'suspend', 'down' also EMPTIES + DELETES the uploads AND db-dumps buckets —")
        warn("the last Cloud SQL dump is DESTROYED. There is no restore after a 'down'.")
        warn("If you want a recoverable ~$0 idle instead, use 'suspend' (keeps the dump).")
        if not confirm(
            "FORCE-destroy the entire dev environment (buckets + dump included)?",
            auto_approve=auto_approve,
        ):
            raise Aborted("aborted")

        # Capture bucket names BEFORE destroy — the outputs vanish once state is gone.
        outputs = self.tofu.output_json()
        uploads = outputs.value("uploads_bucket")
        db_dumps = outputs.value("db_dumps_bucket")
        self.empty_bucket(f"gs://{uploads}" if uploads else "")
        self.empty_bucket(f"gs://{db_dumps}" if db_dumps else "")

        self.cleanup_leaked_negs()  # reap GKE-leaked NEGs BEFORE destroy — they pin the VPC delete
        self.reconcile_deletion_protection()  # correct import-time deletion_protection drift
        self.shelve_protected_secrets()  # [fix #3] out of state → destroy needs no -exclude
        self.down_destroy_with_psc_retry(auto_approve=auto_approve)  # NO -exclude; PSC retry
        self.reap_stranded_router()  # out-of-band router blocks the VPC delete
        self.force_release_psa()  # reclaim the ABANDONed PSA peering + range
        self.restore_protected_secrets()  # re-import the two secrets (GCP objects untouched)
        ok(
            f"destroyed. (State bucket gs://{self.config.state_bucket} and the project are left "
            "intact. app_config/ops_config preserved.)"
        )
