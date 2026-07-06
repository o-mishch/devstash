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
# instance-present export that never verifies exits non-zero and fails the build. The gate + prune
# logic is now SHARED with run.sh's dump_db() via infra/lib/posix/dump.sh (see below), so the two
# can no longer drift; only the caller-specific instance gating (this absent-skip vs. the laptop
# path's start-if-STOPPED) stays per-file.
#
# The export→verify→retry gate and the version-prune are NOT reimplemented here anymore: they are
# the SHARED POSIX helpers ds_export_and_verify_dump + ds_prune_dump_versions in
# infra/lib/posix/dump.sh, the ONE source of truth this step and run.sh's dump_db() (bash) both use.
# Step 2 (prepare) git-cloned the repo into /workspace/repo, so this step (3) `.`-sources the helper
# from there. Everything the helper needs is passed as an ARGUMENT — a git-cloned file is NOT
# processed by Cloud Build $_VAR substitution, so the helper reads only its positional args while
# this inline step maps the $_VAR substitutions onto them (same discipline as the python3 helpers).
set -eu
[ -f /workspace/SUSPEND ] || { echo "not idle — skipping DB export"; exit 0; }

# shellcheck source=infra/lib/posix/dump.sh
. /workspace/repo/infra/lib/posix/dump.sh

DUMP_URI="gs://$_DB_DUMPS_BUCKET/$_DB_DUMP_OBJECT"

# Absent instance → already destroyed by a prior suspend; skip and let the build continue. This
# absent-skip stays here (not in the shared helper): the laptop path's dump_db() adds a
# start-if-STOPPED step this unattended path deliberately omits, so the "instance present?" gating
# differs per caller — only the export/verify/prune primitives are shared.
STATE="$(gcloud sql instances describe "$_DB_INSTANCE" --project="$_PROJECT_ID" --format='value(state)' 2>/dev/null || true)"
if [ -z "$STATE" ]; then
  echo "Cloud SQL instance $_DB_INSTANCE not found — already destroyed by a prior suspend; skipping dump and continuing teardown"
  VERIFIED=""
else
  # Instance present → data-safety gate via the shared helper: export + verify non-empty, with ONE
  # delete-empty + retry. On success DS_DUMP_SIZE_BYTES holds the verified size; a non-zero return
  # means it could not produce a non-empty dump, so ABORT before any destroy.
  if ds_export_and_verify_dump "$_DB_INSTANCE" "$DUMP_URI" devstash "$_PROJECT_ID"; then
    VERIFIED="$DS_DUMP_SIZE_BYTES"
    echo "dump verified ($VERIFIED bytes) — safe to destroy the instance"
  else
    echo "could not produce a non-empty dump after retry — ABORTING before any destroy"
    exit 1
  fi
fi

# Only prune when this run actually produced a verified dump — the absent-instance skip writes
# nothing, so there is no new generation to cap. keep-total = $_DB_DUMP_KEEP noncurrent + the live
# one. Best-effort: a prune failure never fails the build (the verified dump is already safe and the
# bucket lifecycle rule backstops anything left behind).
if [ -n "${VERIFIED:-}" ]; then
  ds_prune_dump_versions "$DUMP_URI" "$(( ${_DB_DUMP_KEEP:-2} + 1 ))" \
    || echo "dump prune failed (non-fatal — lifecycle rule backstops it)"
fi
