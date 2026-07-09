"""gcp/db.py — Cloud SQL dump-target resolution + resume-time restore [fix #5].

CLI zone (3.14). Ports the restore-side of run/gcp/lib/db.sh. Re-architected onto the Python-native
paradigm: a `Db` COLLABORATOR over `GcpConfig` + the typed `Gcloud`/`Tofu` clients. A frozen
`DumpTarget` bundles the resolved coordinates (was the DUMP_INSTANCE/DUMP_URI globals); `restore`
RAISES `InfraError` at the boundary on a real failure (was `die`) and tolerates the benign
delete-of-a-fresh-DB.

[fix #5] `restore` SKIPS the import when the instance was ALREADY LIVE before this resume's apply
ran — importing the older GCS dump would silently drop live data written since the last real
suspend (CONFIRMED 2026-07-06: two back-to-back resumes overwrote a signed-in user's items each
time). The unconditional drop+recreate+import is safe ONLY on a genuine post-suspend restore.
"""

from dataclasses import dataclass

from devstash_infra.clients.gcloud import Gcloud
from devstash_infra.clients.tofu import Tofu
from devstash_infra.common import log, ok, poll_until, warn
from devstash_infra.config import GcpConfig
from devstash_infra.shared.dump import export_and_verify_dump, prune_dump_versions
from devstash_infra.shared.errors import InfraError
from devstash_infra.shared.proc import ProcError

# The compute-only-suspended (STOPPED) instance start-and-wait: ~5 min (30 × 10s) to reach RUNNABLE.
_RUNNABLE_ATTEMPTS = 30
_RUNNABLE_GAP_S = 10.0
# db_dump_keep_versions counts NONCURRENT dumps; fall back to the tofu default when unreadable.
_DEFAULT_KEEP_NONCURRENT = 2


@dataclass(frozen=True)
class DumpTarget:
    """The resolved Cloud SQL dump coordinates (was the DUMP_INSTANCE/DUMP_URI globals). Project is
    not carried — the `Gcloud` client is already scoped to it.
    """

    instance: str
    dump_uri: str
    db_name: str


@dataclass(frozen=True)
class Db:
    """Cloud SQL dump-target resolution + the resume-time restore [#5], over the typed clients."""

    config: GcpConfig
    gcloud: Gcloud
    tofu: Tofu

    def resolve_dump_target(self) -> DumpTarget | None:
        """Build a DumpTarget from tofu outputs, or None if any is missing.

        Reads db_instance_name / db_dumps_bucket / db_dump_object off ONE `tofu output -json` [#2].
        A missing output → None, which `restore` turns into a skip-without-raising (a suspended /
        not-yet-applied env has no dump target).
        """
        outputs = self.tofu.output_json()
        instance = outputs.value("db_instance_name")
        bucket = outputs.value("db_dumps_bucket")
        obj = outputs.value("db_dump_object")
        if not (instance and bucket and obj):
            return None
        return DumpTarget(
            instance=instance, dump_uri=f"gs://{bucket}/{obj}", db_name=self.config.db_name
        )

    def db_already_live(self, target: DumpTarget | None) -> bool:
        """True iff the dump instance already exists in GCP — the `was_already_live` snapshot.

        The resume overlap driver calls this BEFORE its apply: a genuine post-suspend resume finds
        nothing (the apply recreates the instance), while a resume re-run against an already-up env
        finds it — `restore` uses this to refuse importing the older dump over live data [#5].
        """
        return target is not None and self.gcloud.sql.instance_exists(target.instance)

    def dump(
        self,
        *,
        runnable_attempts: int = _RUNNABLE_ATTEMPTS,
        runnable_gap_s: float = _RUNNABLE_GAP_S,
    ) -> None:
        """Export + verify the DB to GCS BEFORE any destroy [fix #4]. Ports db.sh `dump_db`.

        The data-safety gate that replaces Cloud SQL deletion_protection: an instance-present export
        that never verifies non-empty ABORTS the suspend (raises), so we never destroy an
        un-backed-up database. Idempotent teardown: an absent instance (a prior partial suspend
        already destroyed it) is NOT a failure — skip and tear down whatever remains. A STOPPED one
        (compute-only suspend) is started just long enough to take a consistent dump. On success the
        dump history is pruned NOW (best-effort) rather than waiting for the bucket's daily sweep.
        `runnable_gap_s` is injected so the start-and-wait poll runs without a real sleep in tests.
        """
        target = self.resolve_dump_target()
        if target is None:
            raise InfraError(
                "cannot resolve Cloud SQL instance / dump bucket / object from tofu output — "
                "run 'apply' first"
            )
        state = self.gcloud.sql.instance_state(target.instance)
        if not state:
            warn(
                f"Cloud SQL instance '{target.instance}' not found — already destroyed by a prior "
                "suspend; skipping dump and continuing teardown"
            )
            return
        if state != "RUNNABLE":
            warn(f"instance is '{state}' — starting it to take a consistent dump")
            self.gcloud.sql.patch_activation_policy(target.instance, "ALWAYS")
            if not poll_until(
                lambda: self.gcloud.sql.instance_state(target.instance) == "RUNNABLE",
                attempts=runnable_attempts,
                gap_seconds=runnable_gap_s,
            ):
                raise InfraError("instance did not reach RUNNABLE in time — aborting suspend")

        result = export_and_verify_dump(
            target.instance, target.dump_uri, target.db_name, self.config.project
        )
        if not result.verified:
            raise InfraError(
                f"could not produce a non-empty dump of '{target.instance}' after retry — "
                "NOT suspending (instance left intact)"
            )
        ok(f"DB exported and verified ({result.size_bytes} bytes) — safe to destroy the instance")

        # keep-total = noncurrent + 1 (the live dump just written); keep >= 1 always retains it.
        keep = self.tofu.output_json().value("db_dump_keep_versions")
        keep_noncurrent = int(keep) if keep.isdigit() else _DEFAULT_KEEP_NONCURRENT
        prune_dump_versions(target.dump_uri, keep_noncurrent + 1)

    def restore(self, target: DumpTarget | None, *, was_already_live: bool = False) -> None:
        """Import the latest GCS dump into the freshly-recreated instance [#5].

        Best-effort: skips (no raise) when there is nothing to restore. Order matters — the
        already-live guard short-circuits BEFORE even checking the dump object, since an
        already-live instance needs no restore decision from the dump's presence.
        """
        if target is None:
            warn("no instance / dump bucket / object resolved — skipping restore")
            return

        # [fix #5] Already live before this apply → newer than the dump; NEVER overwrite.
        if was_already_live:
            warn(
                f"Cloud SQL instance '{target.instance}' already existed before this resume's "
                "apply ran — this resume is being re-run against an env that was never suspended. "
                "Skipping restore so live data written since the last real suspend is NOT "
                "overwritten by the older GCS dump."
            )
            return

        if not self.gcloud.storage.object_exists(target.dump_uri):
            warn(f"no dump at {target.dump_uri} — fresh database; CI migrations create the schema")
            return

        # CLEAN TARGET before every import (genuine restores only): drop + recreate so a retry after
        # a partial import lands in an empty schema (`gcloud sql import` is NOT idempotent).
        log(
            f"Resetting database '{target.db_name}' on '{target.instance}' to a clean schema "
            "before import"
        )
        try:
            self.gcloud.sql.delete_database(target.db_name, instance=target.instance)
        except ProcError:
            warn(f"database '{target.db_name}' did not exist (fresh instance) — creating it")
        try:
            self.gcloud.sql.create_database(target.db_name, instance=target.instance)
        except ProcError:
            raise InfraError(
                f"could not (re)create database '{target.db_name}' — investigate before the app "
                "deploys"
            ) from None

        log(f"Importing {target.dump_uri} → Cloud SQL '{target.instance}' (db {target.db_name})")
        try:
            self.gcloud.sql.import_sql(target.instance, target.dump_uri, database=target.db_name)
        except ProcError:
            raise InfraError(
                "gcloud sql import failed — the instance is up but empty; re-run 'resume' (restore "
                "is now retry-safe: the DB is reset to empty before each import)"
            ) from None
        ok(f"DB restored from {target.dump_uri}")
