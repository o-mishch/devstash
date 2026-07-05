#!/bin/sh
# Cloud Build step 3 — DUMP (only if idle; see auto-suspend.tf). $_VAR values are Cloud Build
# substitutions mapped onto the step env — the `script` field doesn't expand them in content —
# so plain POSIX shell. Export the live DB to the GCS db-dumps bucket and VERIFY the
# object is non-empty BEFORE the destroy step runs. `set -eu` + the explicit non-empty check
# mean a failed/empty dump exits non-zero, which fails the build so the suspend step NEVER
# destroys an un-dumped instance.
# SIBLING: this is the same export+non-empty-size safety gate run.sh's dump_db() runs on the
# laptop path (infra/run/gcp/run.sh). Different execution model (Cloud Build container vs.
# local shell) so it can't be shared code — if you change the verification rule here, change
# it there too.
set -eu
[ -f /workspace/SUSPEND ] || { echo "not idle — skipping DB export"; exit 0; }
echo "Exporting Cloud SQL $_DB_INSTANCE -> gs://$_DB_DUMPS_BUCKET/$_DB_DUMP_OBJECT"
gcloud sql export sql "$_DB_INSTANCE" "gs://$_DB_DUMPS_BUCKET/$_DB_DUMP_OBJECT" \
  --database=devstash --project="$_PROJECT_ID"
SIZE="$(gcloud storage objects describe "gs://$_DB_DUMPS_BUCKET/$_DB_DUMP_OBJECT" --format='value(size)' 2>/dev/null || true)"
case "$SIZE" in ''|*[!0-9]*) echo "dump missing/invalid size ('$SIZE') — ABORTING before any destroy"; exit 1 ;; esac
[ "$SIZE" -gt 0 ] || { echo "dump is empty — ABORTING before any destroy"; exit 1; }
echo "dump verified ($SIZE bytes) — safe to destroy the instance"

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
prune_dump_versions || echo "dump prune failed (non-fatal — lifecycle rule backstops it)"
