#!/bin/sh
# Cloud Build step 3 — DUMP (only if idle; see auto-suspend.tf). $_VAR values are Cloud Build
# substitutions mapped onto the step env — the `script` field doesn't expand them in content —
# so plain POSIX shell. Export the live DB to the GCS db-dumps bucket and VERIFY the
# object is non-empty BEFORE the destroy step runs. `set -eu` + the explicit non-empty check
# mean a failed/empty dump exits non-zero, which fails the build so the suspend step NEVER
# destroys an un-dumped instance.
# SIBLING: this is the same export+non-empty-size safety gate run.sh's dump_db() runs on the
# laptop path (infra/gcp-run/run.sh). Different execution model (Cloud Build container vs.
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
