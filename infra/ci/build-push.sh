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

# shellcheck source=infra/lib/common.sh
source "$(dirname "${BASH_SOURCE[0]}")/../lib/common.sh"

BASE="$(ds_image_base "$REGION" "$GCP_PROJECT_ID" "$REPO")"
# Exported so the bake file's `variable` blocks pick them up from the environment.
export IMAGE_URI="${BASE}/${IMAGE}"
export MIGRATE_URI="${BASE}/${IMAGE_MIGRATE}"
export GITHUB_SHA

BAKE_FILE="$(dirname "${BASH_SOURCE[0]}")/docker-bake.hcl"

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
