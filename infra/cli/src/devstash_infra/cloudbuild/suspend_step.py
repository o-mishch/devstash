"""cloudbuild/suspend_step.py — step 4: reconcile + tofu apply to drive the env to ~$0. 3.14 floor.

Port of terraform/envs/dev/scripts/auto-suspend-suspend.sh. Now that the verified dump exists,
destroy compute + Cloud SQL + the AR repo via a single `environment_active=false db_active=false`
apply. `-refresh=false` keeps the apply (and this SA's perms) scoped to just what those two vars
change.

OPTION 4 (unified Python on cloud-sdk:slim): unlike the shell — which ran on the OpenTofu image
where gcloud+python3 were ABSENT, silently dead-ending the force-unlock/contention layer — this step
runs on cloud-sdk:slim (gcloud + python3) with the DIGEST-PINNED static `tofu` binary copied onto
PATH via /workspace/bin (the tofu-bin extract step). So all three tools are present and the
force-unlock recovery is genuinely functional here for the first time.

Two safety layers, both preserved:
- RECONCILE branch 4 (`reconcile_ar_iam.purge_stranded_ar_iam`) heals an already-stranded repo-
  scoped AR-IAM state BEFORE the apply, so the unattended path self-recovers from a pre-fix
  stranding exactly as the laptop `suspend` does — else the apply 403s and re-wedges every tick.
- LOCK CONTENTION — apply with a long -lock-timeout (900s, layer 2: wait out the holder), and on a
  lock-acquisition failure ONLY, `force_unlock_if_dead` (layer 3 [fix #1]: force-unlock by the GCS
  object GENERATION, and ONLY when the lock is orphaned — never break a live sibling's destroy).
  A non-lock failure is surfaced (raises) so the build-failure alert fires; a live-sibling lock is
  a benign no-op (the sibling completes the suspend).
"""

import logging
from pathlib import Path

from devstash_infra.cloudbuild.env import AR_IAM_ADDR_FILE, SUSPEND_SENTINEL, TF_DIR, BuildEnv
from devstash_infra.shared import proc
from devstash_infra.shared.errors import InfraError
from devstash_infra.shared.lock_contention import force_unlock_if_dead
from devstash_infra.shared.reconcile_ar_iam import purge_stranded_ar_iam

log = logging.getLogger(__name__)

_AR_REPO = "devstash"  # the Artifact Registry repo id (parity with the shell's literal)

# The suspend apply argv — destroy compute + Cloud SQL + AR through the module gates. -refresh=false
# scopes the plan to just these two vars; -lock-timeout=900s is contention layer 2 (wait out the
# holder for a full GKE+SQL destroy, matching the laptop's wait cap).
_APPLY_ARGV = [
    "tofu",
    "apply",
    "-input=false",
    "-auto-approve",
    "-refresh=false",
    "-lock-timeout=900s",
    "-var",
    "environment_active=false",
    "-var",
    "db_active=false",
]


def _apply(tf_dir: Path) -> proc.Result:
    """Run the suspend apply, streaming live + capturing output for lock/error classification."""
    return proc.long_running(_APPLY_ARGV, cwd=str(tf_dir))


def suspend_step(
    env: BuildEnv,
    *,
    sentinel: Path = SUSPEND_SENTINEL,
    tf_dir: Path = TF_DIR,
    addr_file: Path = AR_IAM_ADDR_FILE,
) -> None:
    """Reconcile stranded AR-IAM, then apply the suspend with guarded lock recovery (idle only)."""
    if not sentinel.exists():
        log.info("not idle — skipping suspend")
        return

    proc.run(
        ["tofu", "init", "-input=false", f"-backend-config=bucket={env.state_bucket}"],
        cwd=str(tf_dir),
    )

    # RECONCILE branch 4 — heal a stranded repo-scoped AR-IAM state before the apply. A failed
    # `state rm` returns False (never silently swallowed): abort so the alert fires.
    if not purge_stranded_ar_iam(_AR_REPO, env.region, env.project_id, str(addr_file)):
        raise InfraError(
            "could not purge a stranded AR-IAM member from state — aborting the suspend apply"
        )

    result = _apply(tf_dir)
    if result.ok:
        return

    # The apply failed. Only treat it as recoverable if tofu SAID it was a lock-acquisition
    # stalemate — otherwise it is a real error: surface it (raise) so the failure alert fires.
    # Without this gate, layer 3 could force-unlock + retry on a genuine destroy error, masking it.
    if not proc.is_lock_error(result.stdout):
        raise InfraError(
            "suspend apply failed for a non-lock reason — surfacing the error (alert will fire)"
        )

    # It IS a lock stalemate. force_unlock_if_dead breaks ONLY an orphaned lock (returns True →
    # retry once) and refuses a live sibling's lock (returns False → no-op; the sibling finishes).
    if not force_unlock_if_dead(
        env.region, env.project_id, env.state_bucket, env.trigger_name, env.build_id
    ):
        log.info(
            "another auto-suspend build holds the lock (or it cleared) — this build is a no-op"
        )
        return

    log.info("retrying the suspend apply after clearing the stale lock")
    if not _apply(tf_dir).ok:
        raise InfraError("suspend apply failed after clearing the stale lock — surfacing the error")
