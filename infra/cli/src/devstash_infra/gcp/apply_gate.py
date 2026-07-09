"""gcp/apply_gate.py — apply-serialisation preflight helpers. CLI zone (3.14).

The run.sh globals that guard state around an apply/suspend/resume: assert the backend bucket
exists (bootstrap ran), serialise against the scheduled idle auto-suspend build (they share ONE
OpenTofu state lock), and the best-effort teardown cleanup. Split out of `gcp/context.py` so the
factory only wires; these are the domain logic it injects into `ApplyDeps`/`Lifecycle`.
"""

from devstash_infra.clients.gcloud import Gcloud
from devstash_infra.common import log, warn
from devstash_infra.gcp.config import GcpConfig
from devstash_infra.shared.clock import SYSTEM_CLOCK, Clock
from devstash_infra.shared.errors import InfraError

# wait_for_no_autosuspend_build: cap the wait so a stuck build can't hang the command forever.
_AUTOSUSPEND_WAIT_S = 900
_AUTOSUSPEND_POLL_S = 20


def require_state_bucket(gcloud: Gcloud, state_bucket: str) -> None:
    """Assert the GCS backend bucket exists before `tofu init` (run.sh:488) — else a cryptic error.

    Raises `InfraError` with an actionable "run bootstrap first" message when the bucket is absent.
    """
    if not gcloud.storage.bucket_exists(f"gs://{state_bucket}"):
        raise InfraError(
            f"State bucket gs://{state_bucket} not found — run 'bootstrap' first to create it."
        )


def wait_for_no_autosuspend_build(
    gcloud: Gcloud,
    config: GcpConfig,
    *,
    clock: Clock = SYSTEM_CLOCK,
    deadline_s: int = _AUTOSUSPEND_WAIT_S,
    poll_s: float = _AUTOSUSPEND_POLL_S,
) -> None:
    """Serialise against the scheduled idle auto-suspend build before touching state.

    That build and a human `apply/suspend/resume` share ONE OpenTofu state lock; if both run the
    second dies mid-flight (and cancelling the build to break the collision can orphan the lock).
    The remote lock only rejects the loser AFTER it starts, so pre-check the CI side: if an
    auto-suspend build for THIS env is QUEUED/WORKING, wait for it. Bounded (`deadline_s`) so a
    genuinely stuck build raises an actionable `InfraError` rather than hanging forever. The
    injected `clock` drives the poll without a real wait in tests.
    """
    trigger = f"devstash-{config.environment}-auto-suspend"
    waited = 0.0
    while True:
        ids = gcloud.builds.ongoing_autosuspend_ids(config.region, config.environment)
        if not ids:
            return
        if waited >= deadline_s:
            raise InfraError(
                f"auto-suspend build {ids[0]} ({trigger}) still running after {deadline_s}s — it "
                f"holds the state lock. Wait for it to finish (gcloud builds log {ids[0]} "
                f"--region={config.region}) or cancel it, then re-run."
            )
        warn(
            f"auto-suspend build {ids[0]} ({trigger}) is running and holds the state lock — "
            "waiting for it to finish before applying…"
        )
        clock.sleep(poll_s)
        waited += poll_s


def cleanup_builds(gcloud: Gcloud, config: GcpConfig) -> None:
    """Cancel in-flight auto-suspend builds + delete the Cloud Build staging bucket.

    Best-effort, off the destroy path: scoped to THIS env's auto-suspend trigger so it never
    cancels an unrelated deploy-gke run a teammate kicked off, and the `${project}_cloudbuild`
    staging-bucket delete tolerates an already-gone bucket.
    """
    ids = gcloud.builds.ongoing_autosuspend_ids(config.region, config.environment)
    if ids:
        log(f"Cancelling in-flight auto-suspend Cloud Builds: {' '.join(ids)}")
        for build_id in ids:
            gcloud.builds.cancel(build_id, region=config.region)
    log(f"Deleting Cloud Build staging bucket gs://{config.project}_cloudbuild")
    gcloud.storage.remove_recursive(f"gs://{config.project}_cloudbuild")
