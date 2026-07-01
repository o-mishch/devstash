#!/usr/bin/env bash
# Build + push the runtime (web) and migrator images to Artifact Registry, then
# publish their immutable registry digests to $GITHUB_ENV / $GITHUB_OUTPUT so later
# steps deploy by digest (a commit-SHA tag can be overwritten by a re-run; a content
# digest cannot).
#
# Required env:
#   REGION, GCP_PROJECT_ID, REPO, IMAGE, IMAGE_MIGRATE  — image coordinates
#   GITHUB_SHA                                          — provided by Actions
#   GITHUB_ENV, GITHUB_OUTPUT                           — provided by Actions
set -euo pipefail

# shellcheck source=infra/lib/common.sh
source "$(dirname "${BASH_SOURCE[0]}")/../lib/common.sh"

BASE="$(ds_image_base "$REGION" "$GCP_PROJECT_ID" "$REPO")"
IMAGE_URI="${BASE}/${IMAGE}"
MIGRATE_URI="${BASE}/${IMAGE_MIGRATE}"

# Runtime image (default last stage) + migrator image (--target migrator). Both builds
# share the same registry remote cache (mode=max includes all intermediate layers). The
# deps + builder stages are reused across builds when the lockfile and schema are
# unchanged — typical saves are 2-4 min. --metadata-file captures the image digest from
# the registry response so we can pass it to SLSA attestation without re-pulling.
docker buildx build \
  --cache-from "type=registry,ref=${IMAGE_URI}:buildcache" \
  --cache-to   "type=registry,ref=${IMAGE_URI}:buildcache,mode=max" \
  --push \
  --metadata-file /tmp/meta-web.json \
  -t "${IMAGE_URI}:${GITHUB_SHA}" -t "${IMAGE_URI}:latest" .

# WHY two --cache-from: deps+builder layers are shared with the web build
# (IMAGE_URI:buildcache, written above). The migrator adds its own unique layers (apk add
# libc6-compat, prisma generate inside the migrator stage, seed files). Those unique
# layers are written to MIGRATE_URI:buildcache so subsequent deploys restore them from
# cache instead of rebuilding cold (~60-120s per run saved). The web build's cache is
# read-only here (no --cache-to for IMAGE_URI) — each image owns its own buildcache tag.
docker buildx build --target migrator \
  --cache-from "type=registry,ref=${IMAGE_URI}:buildcache" \
  --cache-from "type=registry,ref=${MIGRATE_URI}:buildcache" \
  --cache-to   "type=registry,ref=${MIGRATE_URI}:buildcache,mode=max" \
  --push \
  --metadata-file /tmp/meta-migrate.json \
  -t "${MIGRATE_URI}:${GITHUB_SHA}" -t "${MIGRATE_URI}:latest" .

# Extract the registry digest from the buildx metadata file (the canonical sha256 the
# registry assigned — stable across tags on the same manifest).
WEB_DIGEST=$(jq -er '."containerimage.digest"' /tmp/meta-web.json)
MIGRATE_DIGEST=$(jq -er '."containerimage.digest"' /tmp/meta-migrate.json)
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
