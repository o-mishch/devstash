"""cloudbuild/dump_step.py — step 3: dump-verify the DB before any destroy. 3.14 floor.

Port of terraform/envs/dev/scripts/auto-suspend-dump.sh. Export the live DB to GCS and VERIFY the
object is non-empty BEFORE the suspend step destroys anything, so an un-dumped instance is NEVER
torn down [fix #4]. The export→verify→(delete-empty+retry) gate + the version prune are the SHARED
`shared/dump` helpers — the one source of truth this step and the laptop `dump-db` both use.

Only the instance gating is per-caller: an ABSENT instance means a prior partial suspend already
destroyed it (idempotent teardown) — that is not a failure, so we log and continue to let the
suspend step tear down whatever remains. The data-safety abort applies only when the instance still
EXISTS: an instance-present export that never verifies raises, failing the build before any destroy.
"""

import logging
from pathlib import Path

from devstash_infra.cloudbuild.env import SUSPEND_SENTINEL, BuildEnv
from devstash_infra.shared import proc
from devstash_infra.shared.dump import export_and_verify_dump, prune_dump_versions
from devstash_infra.shared.errors import InfraError

log = logging.getLogger(__name__)

_DATABASE = "devstash"  # the single application database (parity with the shell's literal)


def dump_step(env: BuildEnv, *, sentinel: Path = SUSPEND_SENTINEL) -> None:
    """Export + verify the DB dump, or skip if the instance is already gone. No-op unless idle."""
    if not sentinel.exists():
        log.info("not idle — skipping DB export")
        return

    # Absent instance → already destroyed by a prior suspend; skip and let the build continue. The
    # laptop path adds a start-if-STOPPED step this unattended path deliberately omits, so only the
    # "instance present?" gating differs per caller — the export/verify/prune primitives are shared.
    state = proc.run(
        [
            "gcloud",
            "sql",
            "instances",
            "describe",
            env.db_instance,
            f"--project={env.project_id}",
            "--format=value(state)",
        ],
        check=False,
    )
    if not state.ok or not state.out.strip():
        log.info(
            "Cloud SQL instance %s not found — already destroyed by a prior suspend; "
            "skipping dump and continuing teardown",
            env.db_instance,
        )
        return

    # Instance present → data-safety gate: export + verify non-empty (with one delete-empty+retry).
    # verified=False means no non-empty dump could be produced, so ABORT before any destroy.
    result = export_and_verify_dump(env.db_instance, env.dump_uri, _DATABASE, env.project_id)
    if not result.verified:
        raise InfraError(
            "could not produce a non-empty dump after retry — aborting before any destroy"
        )
    log.info("dump verified (%s bytes) — safe to destroy the instance", result.size_bytes)

    # Cap retained versions only when this run produced a verified dump (keep noncurrent + the live
    # one). `prune_dump_versions` is best-effort internally (never raises) — a prune miss never
    # fails the build, and the bucket lifecycle rule backstops anything left behind.
    prune_dump_versions(env.dump_uri, env.db_dump_keep + 1)
