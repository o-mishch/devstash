"""cloudbuild/cleanup_builds.py — step 5: reclaim Cloud Build residue after the suspend. 3.14 floor.

Port of terraform/envs/dev/scripts/auto-suspend-cleanup-builds.sh. Runs AFTER the tofu suspend, off
the critical path, so a hiccup here never blocks the teardown. Two reclamations, both best-effort
(the env is already at ~$0 compute-wise, so a cleanup miss must never fail the build):

1. CANCEL every ongoing build EXCEPT this one (`env.build_id`) so no stray build keeps running
   against the resources we are tearing down. Unlike the laptop path (which scopes to the
   auto-suspend trigger to spare a teammate's deploy), this unattended path cancels ALL others:
   once committed to $0, no build should keep touching the env. Cloud Build has no delete API for
   build RECORDS, so cancelling in-flight work is the only actionable build-state cleanup.
2. DELETE the `${project}_cloudbuild` source-staging bucket — the one Cloud-Build-owned GCS cost
   that survives suspend. Not Terraform-managed (GCP auto-creates it), so deleting causes no drift;
   the next build recreates it.

The `cloudbuild` Cloud Logging log is deliberately NOT purged — that delete is whole-log-only and
would wipe the ERROR entries the build-failure alert's log-based metric counts (auto-suspend.tf).
"""

import logging
from pathlib import Path

from devstash_infra.cloudbuild.env import SUSPEND_SENTINEL, BuildEnv
from devstash_infra.shared import proc

log = logging.getLogger(__name__)


def cleanup_builds(env: BuildEnv, *, sentinel: Path = SUSPEND_SENTINEL) -> None:
    """Cancel other in-flight builds + delete the staging bucket — no-op unless idle."""
    if not sentinel.exists():
        log.info("not idle — skipping build cleanup")
        return

    log.info("cancelling in-flight Cloud Builds (excluding this build %s)", env.build_id)
    # Server-side --filter (id!=self); --ongoing = QUEUED or WORKING. Tolerant: a listing failure
    # leaves ids empty and we simply cancel nothing (best-effort).
    listing = proc.run(
        [
            "gcloud",
            "builds",
            "list",
            f"--region={env.region}",
            f"--project={env.project_id}",
            "--ongoing",
            f"--filter=id!={env.build_id}",
            "--format=value(id)",
        ],
        check=False,
    )
    ids = listing.out.split() if listing.ok else []
    if ids:
        # One batch cancel of every other in-flight build. Best-effort: some may finish mid-cancel.
        cancel = proc.run(
            [
                "gcloud",
                "builds",
                "cancel",
                *ids,
                f"--region={env.region}",
                f"--project={env.project_id}",
                "--quiet",
            ],
            check=False,
        )
        if not cancel.ok:
            log.info(
                "build cancel returned non-zero (some may have finished mid-cancel) — continuing"
            )
    else:
        log.info("no other in-flight builds — nothing to cancel")

    staging = f"gs://{env.project_id}_cloudbuild"
    log.info("deleting Cloud Build staging bucket %s", staging)
    # --quiet won't error if already gone; -r removes staged objects with it. Best-effort.
    removed = proc.run(
        ["gcloud", "storage", "rm", "-r", staging, "--quiet", f"--project={env.project_id}"],
        check=False,
    )
    if not removed.ok:
        log.info("staging bucket delete returned non-zero (likely never created / already gone)")
    log.info(
        "build cleanup complete — in-flight builds cancelled, staging bucket reclaimed for $0 idle"
    )
