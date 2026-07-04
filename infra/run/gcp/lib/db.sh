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
#
# Source-guard: sourcing twice is a harmless no-op.
[[ -n "${_DEVSTASH_GCP_DB_SH:-}" ]] && return 0
_DEVSTASH_GCP_DB_SH=1

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
dump_db() {
  local state size
  ensure_tfvars
  resolve_dump_target || die "cannot resolve Cloud SQL instance / dump bucket / object from tofu output — run 'apply' first"

  # Must be RUNNABLE to export. If a prior compute-only suspend left it STOPPED
  # (activation_policy=NEVER), start it just long enough to dump; the apply that follows
  # destroys it anyway, so this transient start is harmless.
  state="$(gcloud sql instances describe "$DUMP_INSTANCE" --project="$PROJECT_ID" --format='value(state)' 2>/dev/null || true)"
  [[ -n "$state" ]] || die "Cloud SQL instance '$DUMP_INSTANCE' not found — nothing to dump (already deep-suspended?)"
  if [[ "$state" != "RUNNABLE" ]]; then
    warn "instance is '$state' — starting it to take a consistent dump"
    gcloud sql instances patch "$DUMP_INSTANCE" --project="$PROJECT_ID" --activation-policy=ALWAYS --quiet
    poll_until 30 10 -- _sql_runnable "$DUMP_INSTANCE" \
      || die "instance did not reach RUNNABLE in time — aborting suspend"
    echo
  fi

  log "Exporting Cloud SQL '$DUMP_INSTANCE' → $DUMP_URI (server-side pg_dump)"
  gcloud sql export sql "$DUMP_INSTANCE" "$DUMP_URI" --database="$DB_NAME" --project="$PROJECT_ID" \
    || die "gcloud sql export failed — NOT suspending (instance left intact)"

  # Verify the dump exists and is non-empty BEFORE the caller is allowed to destroy the
  # instance. This is the safety gate that replaces Cloud SQL deletion_protection.
  # SIBLING: the event-driven path duplicates this exact export+non-empty-size gate in
  # scripts/auto-suspend-dump.sh (different execution model — Cloud Build container — so it
  # can't be shared code). If you change the verification rule here, change it there too.
  size="$(gcloud storage objects describe "$DUMP_URI" --format='value(size)' 2>/dev/null || true)"
  [[ "$size" =~ ^[0-9]+$ && "$size" -gt 0 ]] || die "dump $DUMP_URI missing or empty (size='${size:-none}') — NOT suspending"
  ok "DB exported and verified ($((size / 1024)) KiB) — safe to destroy the instance"
}

# restore_db: import the latest GCS dump into the freshly-recreated Cloud SQL instance on
# resume. Best-effort: on a first-ever bring-up there is no dump, so it skips and lets the
# CI Prisma migrations create the schema. The dump includes the _prisma_migrations table,
# so when a dump IS restored the CI migrate step is a no-op.
restore_db() {
  ensure_tfvars
  resolve_dump_target || { warn "no instance / dump bucket / object resolved — skipping restore"; return 0; }
  if ! gcloud storage objects describe "$DUMP_URI" >/dev/null 2>&1; then
    warn "no dump at $DUMP_URI — fresh database; CI migrations will create the schema"
    return 0
  fi
  log "Importing $DUMP_URI → Cloud SQL '$DUMP_INSTANCE' (database $DB_NAME)"
  gcloud sql import sql "$DUMP_INSTANCE" "$DUMP_URI" --database="$DB_NAME" --project="$PROJECT_ID" --quiet \
    || die "gcloud sql import failed — the instance is up but empty; investigate before the app deploys"
  ok "DB restored from $DUMP_URI"
}
