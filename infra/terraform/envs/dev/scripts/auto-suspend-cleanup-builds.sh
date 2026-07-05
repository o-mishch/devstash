#!/bin/sh
# Cloud Build step 6 — CLEANUP BUILDS (only if idle; see auto-suspend.tf). $_VAR values are
# Cloud Build substitutions mapped onto the step env — the `script` field doesn't expand them
# in content — so plain POSIX shell. Runs AFTER the tofu suspend + registry delete, off the
# critical dump→destroy path, so a hiccup here never blocks the teardown.
#
# WHY — a deep-suspended env should hold zero avoidable Cloud Build residue:
#   1. CANCEL any QUEUED/WORKING builds (except THIS one) so no stray build keeps running —
#      or, worse, resurrects state — while we drive to $0. Cloud Build has NO delete API for
#      build RECORDS (Google expires them by retention), so the history list can't be emptied;
#      cancelling in-flight work is the only actionable build-state cleanup.
#   2. DELETE the ${project}_cloudbuild source-staging bucket. It holds uploaded source tarballs
#      + is the one Cloud-Build-owned GCS cost that survives suspend. It is NOT Terraform-managed
#      (GCP auto-creates it on first use), so deleting it causes no state drift; the next build
#      that needs it recreates it automatically.
#
# We deliberately DO NOT purge the `cloudbuild` Cloud Logging log: that delete is whole-log-only
# (no per-build filter), so it would also wipe the ERROR entries the auto-suspend-build-failing
# alert's log-based metric counts (see auto-suspend.tf). Build logs age out via Logging retention.
#
# Best-effort throughout: every failure is logged and swallowed — the environment is already at
# ~$0 compute-wise, so a cleanup miss must never fail the suspend build.
set -eu
[ -f /workspace/SUSPEND ] || { echo "not idle — skipping build cleanup"; exit 0; }

# 1 — Cancel every ongoing build EXCEPT this one. $_BUILD_ID is Cloud Build's own build id
# (passed in from the built-in $BUILD_ID substitution); excluding it stops us cancelling the
# suspend build out from under itself. One server-side --filter; --ongoing = QUEUED or WORKING.
echo "Cancelling in-flight Cloud Builds (excluding this build $_BUILD_ID)"
IDS="$(gcloud builds list --region="$_REGION" --project="$_PROJECT_ID" --ongoing \
         --filter="id!=$_BUILD_ID" --format='value(id)' 2>/dev/null || true)"
if [ -n "$IDS" ]; then
  # shellcheck disable=SC2086 # word-splitting is intended: pass each id as its own argument.
  gcloud builds cancel $IDS --region="$_REGION" --project="$_PROJECT_ID" --quiet \
    || echo "build cancel returned non-zero (some may have finished mid-cancel) — continuing"
else
  echo "no other in-flight builds — nothing to cancel"
fi

# 2 — Delete the source-staging bucket. --quiet won't error if it is already gone; -r removes
# any staged objects with it. Best-effort: a miss (never created, already deleted) is fine.
STAGING="gs://${_PROJECT_ID}_cloudbuild"
echo "Deleting Cloud Build staging bucket $STAGING"
gcloud storage rm -r "$STAGING" --quiet --project="$_PROJECT_ID" \
  || echo "staging bucket delete returned non-zero (likely never created / already gone) — continuing"
echo "build cleanup complete — in-flight builds cancelled, staging bucket reclaimed for \$0 idle"
