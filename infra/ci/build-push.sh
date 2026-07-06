#!/usr/bin/env bash
# Build + push the runtime (web) and migrator images to Artifact Registry, then
# publish their immutable registry digests to $GITHUB_ENV / $GITHUB_OUTPUT so later
# steps deploy by digest (a commit-SHA tag can be overwritten by a re-run; a content
# digest cannot).
#
# Both images build in ONE `docker buildx bake` session (infra/ci/docker-bake.hcl):
# the shared deps/builder stages are computed once and the two targets build
# concurrently, instead of two sequential builds that each re-import the shared
# graph. Layer cache uses the GitHub Actions cache backend (type=gha) — Docker's
# recommended backend on GitHub-hosted runners; it avoids the Artifact Registry
# round-trip the old type=registry cache paid on every import and export.
#
# Required env:
#   REGION, GCP_PROJECT_ID, REPO, IMAGE, IMAGE_MIGRATE  — image coordinates
#   GITHUB_SHA                                          — provided by Actions
#   GITHUB_ENV, GITHUB_OUTPUT                           — provided by Actions
set -euo pipefail

# Fail fast if a required env var is missing; also silences shellcheck SC2153 for
# these workflow-provided uppercase vars (their lowercase lookalikes appear only in comments).
# REPO + GCP_PROJECT_ID are asserted here too — the AR-writable gate below consumes them directly.
: "${REGION:?REGION is required}" "${GCP_PROJECT_ID:?GCP_PROJECT_ID is required}" "${REPO:?REPO is required}"

# shellcheck source=infra/lib/common.sh
source "$(dirname "${BASH_SOURCE[0]}")/../lib/common.sh"

BASE="$(ds_image_base "$REGION" "$GCP_PROJECT_ID" "$REPO")"
# Exported so the bake file's `variable` blocks pick them up from the environment.
export IMAGE_URI="${BASE}/${IMAGE}"
export MIGRATE_URI="${BASE}/${IMAGE_MIGRATE}"
export GITHUB_SHA

BAKE_FILE="$(dirname "${BASH_SOURCE[0]}")/docker-bake.hcl"

# ── Gate the push on Artifact Registry being WRITABLE ───────────────────────────────────────
# WHY: run.sh resume/first-apply PRE-DISPATCHES deploy-gke so this cluster-independent build
# overlaps `tofu apply`. But the AR repo AND the deployer SA's repo-scoped repoAdmin binding are
# count=environment_active — destroyed on suspend, recreated only PARTWAY THROUGH that still-running
# apply. bake's push can therefore reach the registry BEFORE the binding lands and fail with a hard
# `denied: ...uploadArtifacts` (not a flake — the step-security retry then hits the SAME 403 on both
# attempts). Poll ds_ar_writable (repo exists + our SA carries a write role) until true, so ONLY the
# push waits for AR; the deps/builder stages still build concurrently with apply, preserving the
# overlap's whole point. Mirrors check-env-active.sh's bounded-poll shape.
#   AR_WAIT_ATTEMPTS (default 40) × AR_WAIT_GAP secs (default 15) = ~10 min max — the same envelope
#   as the cluster wait, covering IAM apply + propagation without ever outliving the job's 15m cap.
ar_attempts="${AR_WAIT_ATTEMPTS:-40}"
ar_gap="${AR_WAIT_GAP:-15}"
i=0
while ! ds_ar_writable "$REGION" "$GCP_PROJECT_ID" "$REPO"; do
  i=$((i + 1))
  if [ "$i" -ge "$ar_attempts" ]; then
    echo "::error::Artifact Registry '$REPO' not writable by the deployer SA after ~$((ar_attempts * ar_gap))s (repo missing or repoAdmin/writer binding not applied). A resume apply may still be recreating it, or project-IAM state is unconverged — see modules/iam deployer_artifact_registry."
    exit 1
  fi
  echo "Artifact Registry '$REPO' not writable yet (attempt $i/$ar_attempts) — a resume apply may be recreating the repo/IAM binding; waiting ${ar_gap}s…"
  sleep "$ar_gap"
done
# The IAM policy can read back present a beat before it propagates to the registry data plane
# (the token exchange the push does). A short settle absorbs that residual gap without a full retry.
echo "Artifact Registry '$REPO' is writable — proceeding to build + push."
sleep 5

# --metadata-file captures each target's registry digest so we can pass it to SLSA
# attestation without re-pulling. Output is keyed by target name.
docker buildx bake --file "$BAKE_FILE" --metadata-file /tmp/meta-bake.json

# Extract the registry digest per target from the buildx metadata (the canonical
# sha256 the registry assigned — stable across tags on the same manifest).
WEB_DIGEST=$(jq -er '.web."containerimage.digest"' /tmp/meta-bake.json)
MIGRATE_DIGEST=$(jq -er '.migrate."containerimage.digest"' /tmp/meta-bake.json)
if [[ ! "$WEB_DIGEST" =~ ^sha256:[0-9a-f]{64}$ || ! "$MIGRATE_DIGEST" =~ ^sha256:[0-9a-f]{64}$ ]]; then
  echo "::error::BuildKit did not return valid registry image digests"
  exit 1
fi

# Deploy by registry digest. A commit-SHA tag can still be overwritten by a workflow
# re-run; a content digest cannot.
{
  echo "IMAGE_URI=${IMAGE_URI}"
  echo "WEB_DIGEST=${WEB_DIGEST}"
  echo "MIGRATE_IMAGE=${MIGRATE_URI}@${MIGRATE_DIGEST}"
} >> "$GITHUB_ENV"
{
  echo "web_image_name=${IMAGE_URI}"
  echo "web_digest=${WEB_DIGEST}"
  echo "migrate_image_name=${MIGRATE_URI}"
  echo "migrate_digest=${MIGRATE_DIGEST}"
} >> "$GITHUB_OUTPUT"
