# shellcheck shell=bash
# Cloud SQL dump/restore for the GCP deploy tooling. SOURCED by infra/run/gcp/run.sh (never
# executed) — it shares run.sh's shell scope, so the functions here rely on state the parent
# already established. Split out of run.sh purely to keep that orchestrator readable; this is
# organisational, not a standalone module.
#
# Depends on (provided by run.sh before this file is sourced):
#   globals   PROJECT_ID, DB_NAME
#   helpers   log/ok/warn/die (infra/lib/common.sh), tf_out, poll_until, ensure_tfvars
# Sets (shared globals, consumed within this file):
#   DUMP_INSTANCE, DUMP_URI  (populated by resolve_dump_target)
#   DUMP_SIZE_KIB            (verified dump size, set by _export_and_verify_dump)
#
# Source-guard: sourcing twice is a harmless no-op.
[[ -n "${_DEVSTASH_GCP_DB_SH:-}" ]] && return 0
_DEVSTASH_GCP_DB_SH=1

# The export→verify→retry gate and the GCS version-prune are SHARED (identical logic, POSIX-sh) with
# the unattended Cloud Build dump step (scripts/auto-suspend-dump.sh) via infra/lib/posix/dump.sh —
# the ONE source of truth for both runtimes. bash sources POSIX sh transparently. This replaces the
# hand-mirrored copy db.sh used to keep in sync with the Cloud Build path.
# shellcheck source=infra/lib/posix/dump.sh
source "$(dirname "${BASH_SOURCE[0]}")/../../../lib/posix/dump.sh"

# resolve_dump_target: read the three GCS-dump coordinates from tofu output and set the
# shared globals DUMP_INSTANCE + DUMP_URI. Returns non-zero (setting nothing) if any output
# is empty — the normal case for a not-yet-applied env. Callers decide the severity of that
# (dump_db dies, restore_db warns+skips), so the resolution logic lives here exactly once.
# db_dump_object is the single source of truth (locals.tf) shared with the auto-suspend path,
# so suspend writes and resume read the exact same GCS object.
resolve_dump_target() {
  local bucket object
  DUMP_INSTANCE="$(tf_out db_instance_name)"
  bucket="$(tf_out db_dumps_bucket)"
  object="$(tf_out db_dump_object)"
  [[ -n "$DUMP_INSTANCE" && -n "$bucket" && -n "$object" ]] || return 1
  DUMP_URI="gs://${bucket}/${object}"
}

# dump_db: server-side export of the live Cloud SQL DB to the GCS dump bucket, run BEFORE
# a deep suspend destroys the instance. `gcloud sql export` makes Cloud SQL's own service
# agent run pg_dump straight to GCS, so it works over the instance's private-only network
# (no public IP / laptop connectivity needed). Verifies the object is non-empty and ABORTS
# on any failure — suspend() must not destroy the instance unless this returns 0.
_sql_runnable() {
  [[ "$(gcloud sql instances describe "$1" --project="$PROJECT_ID" --format='value(state)' 2>/dev/null)" == "RUNNABLE" ]]
}
# _sql_instance_exists <instance>: 0 iff <instance> is describable at all, regardless of state.
# Used by resume's overlap driver to snapshot "did Cloud SQL already exist BEFORE this apply ran"
# — see restore_db's "already-live" guard below for why that snapshot matters.
_sql_instance_exists() {
  gcloud sql instances describe "$1" --project="$PROJECT_ID" >/dev/null 2>&1
}
# _export_and_verify_dump: thin wrapper over ds_export_and_verify_dump (infra/lib/posix/dump.sh) —
# the shared export → verify → (delete-empty + retry) gate, single-sourced with the Cloud Build
# dump step. Maps db.sh's globals onto the helper's positional args and translates the returned
# byte size into DUMP_SIZE_KIB for the caller's log. Returns non-zero (which dump_db turns into the
# data-safety abort) iff a non-empty dump could not be produced after the retry.
_export_and_verify_dump() {
  DUMP_SIZE_KIB=""
  ds_export_and_verify_dump "$DUMP_INSTANCE" "$DUMP_URI" "$DB_NAME" "$PROJECT_ID" || return 1
  DUMP_SIZE_KIB="$((DS_DUMP_SIZE_BYTES / 1024))"
}
dump_db() {
  local state
  ensure_tfvars
  resolve_dump_target || die "cannot resolve Cloud SQL instance / dump bucket / object from tofu output — run 'apply' first"

  # IDEMPOTENT TEARDOWN: a prior partial suspend may have already destroyed the instance. That is
  # NOT a failure — there is nothing left to dump (and a gone instance can't be dumped retroactively
  # anyway), so log it and SKIP so the caller proceeds to tear down whatever remains (e.g. GKE).
  # The data-safety gate below only applies when the instance still EXISTS. SIBLING: same
  # absent-instance skip in scripts/auto-suspend-dump.sh — keep in sync.
  state="$(gcloud sql instances describe "$DUMP_INSTANCE" --project="$PROJECT_ID" --format='value(state)' 2>/dev/null || true)"
  if [[ -z "$state" ]]; then
    warn "Cloud SQL instance '$DUMP_INSTANCE' not found — already destroyed by a prior suspend; skipping dump and continuing teardown"
    return 0
  fi

  # Must be RUNNABLE to export. If a prior compute-only suspend left it STOPPED
  # (activation_policy=NEVER), start it just long enough to dump; the apply that follows
  # destroys it anyway, so this transient start is harmless.
  if [[ "$state" != "RUNNABLE" ]]; then
    warn "instance is '$state' — starting it to take a consistent dump"
    gcloud sql instances patch "$DUMP_INSTANCE" --project="$PROJECT_ID" --activation-policy=ALWAYS --quiet
    poll_until 30 10 -- _sql_runnable "$DUMP_INSTANCE" \
      || die "instance did not reach RUNNABLE in time — aborting suspend"
    echo
  fi

  # The instance EXISTS, so the data-safety gate is in force: export + verify non-empty (with one
  # delete-empty + retry) BEFORE the caller is allowed to destroy it. This replaces Cloud SQL
  # deletion_protection — an instance-present export that never verifies ABORTS the suspend, so we
  # never destroy an un-backed-up database.
  _export_and_verify_dump \
    || die "could not produce a non-empty dump of '$DUMP_INSTANCE' after retry — NOT suspending (instance left intact)"
  ok "DB exported and verified (${DUMP_SIZE_KIB} KiB) — safe to destroy the instance"

  # Force the dump history down NOW rather than waiting for the bucket's ~daily lifecycle sweep.
  # db_dump_keep_versions counts NONCURRENT dumps (matching the lifecycle rule in db-dumps.tf),
  # so total generations to keep is that + 1 (the live dump just written). Read from tofu output
  # so the count stays single-sourced; fall back to the variable's own default (2) if the output
  # is unavailable. Best-effort: never fail the suspend over prune (the verified dump is safe and
  # the lifecycle rule backstops anything left). CRITICAL: keep >= 1 always retains the live dump.
  local keep_noncurrent
  keep_noncurrent="$(tf_out db_dump_keep_versions)"
  [[ "$keep_noncurrent" =~ ^[0-9]+$ ]] || keep_noncurrent=2
  # ds_prune_dump_versions (infra/lib/posix/dump.sh) — the SAME prune the Cloud Build dump step runs,
  # single-sourced. keep-total = noncurrent + 1 (the live dump just written); keep >= 1 always
  # retains the live object. Best-effort: never fails the suspend (the verified dump is already safe).
  ds_prune_dump_versions "$DUMP_URI" "$((keep_noncurrent + 1))"
}

# restore_db <was-already-live>: import the latest GCS dump into the freshly-recreated Cloud SQL
# instance on resume. Best-effort: on a first-ever bring-up there is no dump, so it skips and lets
# the CI Prisma migrations create the schema. The dump includes the _prisma_migrations table, so
# when a dump IS restored the CI migrate step is a no-op.
#
# <was-already-live> ("true"/"false", default "false"): whether the Cloud SQL instance was ALREADY
# describable (any state) BEFORE this resume's apply ran — the caller snapshots this via
# _sql_instance_exists BEFORE _apply_plan/_apply_exec. When "true", `resume` is being re-run
# against an env that was never actually suspended (or a prior resume already brought it up) — the
# instance already holds whatever the app has written since the LAST real suspend, which is newer
# than the GCS dump by definition (dump_db only runs from suspend()). Importing the old dump here
# would silently drop that live data. CONFIRMED LIVE 2026-07-06: two `resume` calls run back to
# back overwrote a signed-in user's items each time — every dump taken afterward showed a
# freshly-recreated user with zero items, because restore_db kept re-importing the prior dump over
# an already-live database instead of skipping. Skip (warn, do not import) when true; the
# unconditional drop+recreate+import below is safe ONLY on a genuine post-suspend restore.
#
# CLEAN TARGET before every import (genuine restores only): drop and recreate the logical database
# first, so the import always lands in an empty schema. `gcloud sql import` (pg_restore/psql) is
# NOT idempotent — a retry after a partially-completed import (network blip, timeout) hits
# "relation already exists" and can never re-import cleanly. Terraform recreates the instance with
# an EMPTY devstash database on a genuine resume, so the first try is clean anyway; the
# drop+recreate makes a SECOND try equally clean with no manual `gcloud sql databases delete`
# dance. Ordering is safe: restore_db runs after apply (instance RUNNABLE) and before deploy, and
# the drop+recreate happens before any app/migrate pod can connect, so nothing is holding a
# connection.
restore_db() {
  local was_already_live="${1:-false}"
  ensure_tfvars
  resolve_dump_target || { warn "no instance / dump bucket / object resolved — skipping restore"; return 0; }
  if [[ "$was_already_live" == "true" ]]; then
    warn "Cloud SQL instance '$DUMP_INSTANCE' already existed before this resume's apply ran — this resume is being re-run against an env that was never suspended. Skipping restore so live data written since the last real suspend is NOT overwritten by the older GCS dump."
    return 0
  fi
  if ! gcloud storage objects describe "$DUMP_URI" >/dev/null 2>&1; then
    warn "no dump at $DUMP_URI — fresh database; CI migrations will create the schema"
    return 0
  fi
  # Drop + recreate the target database so the import lands in a clean schema even on a retry
  # after a partial import. Deleting a Cloud SQL database drops it and all its objects; the
  # recreate leaves an empty database owned by the instance for the import to populate. Both
  # are idempotent for our purposes (--quiet; the recreate is a fresh empty DB every resume).
  log "Resetting database '$DB_NAME' on '$DUMP_INSTANCE' to a clean schema before import"
  gcloud sql databases delete "$DB_NAME" --instance="$DUMP_INSTANCE" --project="$PROJECT_ID" --quiet \
    || warn "database '$DB_NAME' did not exist (fresh instance) — creating it"
  gcloud sql databases create "$DB_NAME" --instance="$DUMP_INSTANCE" --project="$PROJECT_ID" --quiet \
    || die "could not (re)create database '$DB_NAME' — investigate before the app deploys"
  log "Importing $DUMP_URI → Cloud SQL '$DUMP_INSTANCE' (database $DB_NAME)"
  gcloud sql import sql "$DUMP_INSTANCE" "$DUMP_URI" --database="$DB_NAME" --project="$PROJECT_ID" --quiet \
    || die "gcloud sql import failed — the instance is up but empty; re-run 'run.sh resume' (restore is now retry-safe: the DB is reset to empty before each import)"
  ok "DB restored from $DUMP_URI"
}
