#!/bin/sh
# Cloud Build step 3 — DUMP (only if idle; see auto-suspend.tf). $_VAR values are Cloud Build
# substitutions mapped onto the step env — the `script` field doesn't expand them in content —
# so plain POSIX shell. Export the live DB to the GCS db-dumps bucket and VERIFY the
# object is non-empty BEFORE the destroy step runs, so the suspend step NEVER destroys an
# un-dumped instance.
#
# IDEMPOTENT TEARDOWN: a prior partial suspend (e.g. one that 403'd mid-teardown) may have
# already destroyed the instance. That is NOT a failure — there is nothing to dump, so this step
# LOGS it and exits 0 so the build proceeds to the destroy step and tears down whatever remains
# (e.g. a GKE cluster the failed run never reached). The data-safety gate (export + non-empty
# verify, with one delete-empty + retry) applies only when the instance still EXISTS: an
# instance-present export that never verifies exits non-zero and fails the build.
# SIBLING: this is the same absent-skip + export/verify/retry gate run.sh's dump_db() runs on the
# laptop path (infra/run/gcp/run.sh). Different execution model (Cloud Build container vs. local
# shell) so it can't be shared code — if you change the rules here, change them there too.
set -eu
[ -f /workspace/SUSPEND ] || { echo "not idle — skipping DB export"; exit 0; }

DUMP_URI="gs://$_DB_DUMPS_BUCKET/$_DB_DUMP_OBJECT"

# Absent instance → already destroyed by a prior suspend; skip and let the build continue.
STATE="$(gcloud sql instances describe "$_DB_INSTANCE" --project="$_PROJECT_ID" --format='value(state)' 2>/dev/null || true)"
if [ -z "$STATE" ]; then
  echo "Cloud SQL instance $_DB_INSTANCE not found — already destroyed by a prior suspend; skipping dump and continuing teardown"
else
  # Instance present → data-safety gate: export + verify non-empty, with ONE delete-empty + retry.
  # gcloud sql export can leave a 0-byte object on a transient failure; re-verifying against that
  # stale object would falsely pass a later run, so the retry deletes it first, then re-exports.
  VERIFIED=""
  for ATTEMPT in 1 2; do
    echo "Exporting Cloud SQL $_DB_INSTANCE -> $DUMP_URI (attempt $ATTEMPT/2)"
    gcloud sql export sql "$_DB_INSTANCE" "$DUMP_URI" --database=devstash --project="$_PROJECT_ID" \
      || echo "gcloud sql export failed (attempt $ATTEMPT)"
    SIZE="$(gcloud storage objects describe "$DUMP_URI" --format='value(size)' 2>/dev/null || true)"
    case "$SIZE" in
      ''|*[!0-9]*) : ;;  # missing / non-numeric → fall through to delete + retry
      *) if [ "$SIZE" -gt 0 ]; then VERIFIED="$SIZE"; break; fi ;;
    esac
    echo "dump missing/empty (size='$SIZE') — deleting partial object before retry"
    gcloud storage rm "$DUMP_URI" --quiet 2>/dev/null || true
  done
  [ -n "$VERIFIED" ] || { echo "could not produce a non-empty dump after retry — ABORTING before any destroy"; exit 1; }
  echo "dump verified ($VERIFIED bytes) — safe to destroy the instance"
fi

# SYNCHRONOUS version cap — mirror of gcs_prune_versions() (infra/lib/common.sh) that the laptop
# path runs, reimplemented in POSIX sh because this Cloud Build step cannot source that file (see
# header). Force the dump history down to $_DB_DUMP_KEEP noncurrent + the live one (= KEEP+1 total)
# the instant the dump lands, instead of waiting for the bucket's ~daily lifecycle sweep. Generation
# numbers increase monotonically, so a reverse sort is newest-first; keep the first KEEP+1 and delete
# the rest by explicit #generation URL (never touches the live dump as long as KEEP+1 >= 1). Wrapped
# so a prune failure never fails the build — the verified dump is already safe and the lifecycle rule
# backstops anything left behind.
prune_dump_versions() {
  KEEP_TOTAL=$(( ${_DB_DUMP_KEEP:-2} + 1 ))
  URI="gs://$_DB_DUMPS_BUCKET/$_DB_DUMP_OBJECT"
  gcloud storage ls -a "$URI" 2>/dev/null | grep '#[0-9]' | sort -r | awk -v keep="$KEEP_TOTAL" 'NR > keep' \
    | while IFS= read -r gen; do
        [ -n "$gen" ] || continue
        gcloud storage rm "$gen" --quiet 2>/dev/null || echo "could not delete $gen (leaving for lifecycle backstop)"
      done
  echo "dump history pruned to newest $KEEP_TOTAL"
}
# Only prune when this run actually produced a verified dump — the absent-instance skip writes
# nothing, so there is no new generation to cap (and the ls would just no-op anyway).
if [ -n "${VERIFIED:-}" ]; then
  prune_dump_versions || echo "dump prune failed (non-fatal — lifecycle rule backstops it)"
fi
