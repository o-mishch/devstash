#!/usr/bin/env bash
# Post-rollout prune: keep ONLY the just-deployed version per image, delete every older one
# IMMEDIATELY. The keep-recent (keep_count=1) cleanup policy on the repository already does
# the same thing, but only on Artifact Registry's ~daily ASYNC sweep; this makes the deletion
# happen the moment a deploy is proven healthy. Runs AFTER wait-rollout.sh, so no previous
# version is still being served.
#
# EXHAUSTIVE — sweeps EVERY package in the repo, not just the known runtime images. Packages are
# DISCOVERED live (gcloud artifacts packages list) so the sweep also collapses anything the
# static DEVSTASH_IMAGES list misses — a renamed/added build target, a stray tag, an orphaned
# package left behind by an aborted build — down to a single version. Each discovered package is
# routed to one of two policies:
#   - KNOWN images (web/migrate, in DEVSTASH_IMAGES): keep the SPECIFIC just-deployed digest
#     (WEB_DIGEST/MIGRATE_DIGEST) + its children. If that digest env var is absent (script run
#     outside the normal CI flow), the package is SKIPPED — never prune a known image without
#     knowing which digest is live, or we could delete the image the cluster is serving.
#   - EXTRA packages (everything else): keep the NEWEST version + its children, delete the rest.
#     These are not the running app's deployed images, so "newest" is a safe keep target.
#
# SAFETY — multi-manifest images. buildx pushes, per image, a TAGGED index plus UNTAGGED child
# platform + SLSA-attestation manifests. We must never delete an untagged manifest directly:
# it may be a child of the CURRENT index. So we only ever delete TAGGED indexes whose digest is
# not the keep digest; `--delete-tags` then orphans that old index's children, which Artifact
# Registry garbage-collects on its own. The current index — and therefore its children — is
# skipped by digest, so the live image is never touched.
#
# Best-effort: a prune hiccup (e.g. missing delete permission) must never fail an already-
# successful deploy. The workflow step is continue-on-error, and each delete failure is logged
# and skipped rather than aborting.
#
# Required env:
#   REGION, GCP_PROJECT_ID, REPO                  — image coordinates (job env)
#   <NAME>_DIGEST for each image in DEVSTASH_IMAGES — WEB_DIGEST, MIGRATE_DIGEST: the immutable
#                                                    registry digests build-push.sh emitted.
set -euo pipefail

# shellcheck source=infra/lib/common.sh
source "$(dirname "${BASH_SOURCE[0]}")/../lib/common.sh"

BASE="$(ds_image_base "$REGION" "$GCP_PROJECT_ID" "$REPO")"

# Calculate the cutoff time (30 minutes ago) in UTC to protect recent images
# from being deleted by concurrent/overlapping GHA runs.
if date --version &>/dev/null; then
  # GNU date (Linux GHA runner)
  CUTOFF=$(date -u -d "30 minutes ago" +"%Y-%m-%dT%H:%M:%SZ")
else
  # BSD date (macOS local runs)
  CUTOFF=$(date -v-30M -u +"%Y-%m-%dT%H:%M:%SZ")
fi

# prune_pass <label> <want-index>: delete every superseded manifest of the selected media-type
# class from $image_path. <want-index> is "index" to act on OCI Indexes (parent manifests) or
# "manifest" to act on the rest (child/platform/attestation manifests); the other class is
# skipped. Kept digests (the parent index + its children, in the $keep_list array) are always
# preserved. Closes over image_path/keep_list/CUTOFF/GCP_PROJECT_ID from the per-image loop
# below. The two passes MUST re-list (not cache) because pass 1 deleting indexes is what orphans
# the children pass 2 then collects — so re-listing is correct, not wasteful.
prune_pass() {
  local label="$1" want_index="$2" version media_type is_index
  while IFS=$'\t' read -r version media_type; do
    [[ -z "$version" ]] && continue
    [[ "$media_type" == *"index"* ]] && is_index=index || is_index=manifest
    [[ "$is_index" != "$want_index" ]] && continue
    # Exact-match membership against the keep-digest array (no whitespace-string matching).
    if printf '%s\n' "${keep_list[@]}" | grep -qxF "$version"; then
      echo "prune-registry: keeping active $label ${image_path}@${version}"
      continue
    fi
    echo "prune-registry: deleting superseded $label ${image_path}@${version}"
    if ! gcloud artifacts docker images delete "${image_path}@${version}" \
         --delete-tags --quiet --project="$GCP_PROJECT_ID"; then
      echo "::warning::prune-registry: failed to delete ${image_path}@${version} (continuing)"
    fi
  done < <(gcloud artifacts docker images list "$image_path" \
             --filter="createTime < $CUTOFF" \
             --format="value(version,metadata.mediaType)" \
             --project="$GCP_PROJECT_ID" 2>/dev/null || true)
}

# prune_package <image_path> <keep_digest>: collapse one package to the single <keep_digest> +
# its children, deleting every other tagged index. Sets image_path/keep_list (the globals
# prune_pass closes over) then runs the two ordered passes. Protects the parent index digest AND
# every child digest it references (platform manifests, SBOM, provenance) so orphaning is left to
# Artifact Registry's own GC — we never delete a child directly.
prune_package() {
  image_path="$1"
  local keep_digest="$2" child
  echo "prune-registry: ${image_path} — keeping ${keep_digest} and its children"

  # Read children into an array (mapfile) rather than a whitespace-joined string, so membership is
  # an exact-match test with no unquoted word-split. `|| true` keeps a childless single-arch image
  # (jq → empty) from tripping set -e; -t drops the trailing newline mapfile would otherwise keep.
  keep_list=("$keep_digest")
  mapfile -t children < <(docker manifest inspect "${image_path}@${keep_digest}" \
    | jq -r 'if .manifests then .manifests[].digest else empty end' 2>/dev/null || true)
  for child in "${children[@]}"; do
    [[ -z "$child" ]] && continue
    keep_list+=("$child")
    echo "prune-registry: protecting child manifest ${child}"
  done

  # Pass 1: delete OCI Indexes (parent manifests) first to unreference child manifests.
  prune_pass index index
  # Pass 2: delete any remaining child/attestation manifests that are not kept.
  prune_pass manifest manifest
}

# newest_index_digest <image_path>: echo the digest of the most-recently-created TAGGED OCI index
# for a package, or nothing. Used for EXTRA (unknown) packages that have no just-deployed digest to
# protect — "keep only 1" there means keep the newest. We deliberately keep a TAGGED index (not any
# newest manifest) so the kept digest is a real image whose children we can enumerate, mirroring the
# known-image path; its untagged children are protected via prune_package, not kept blindly.
newest_index_digest() {
  gcloud artifacts docker images list "$1" --include-tags --sort-by=~createTime \
    --filter='metadata.mediaType~index AND tags:*' \
    --format='value(version)' --limit=1 --project="$GCP_PROJECT_ID" 2>/dev/null | head -1
}

# is_known_image <pkg>: exit 0 iff <pkg> is one of the build's runtime images (DEVSTASH_IMAGES).
is_known_image() {
  printf '%s\n' "${DEVSTASH_IMAGES[@]}" | grep -qxF "$1"
}

# Discover EVERY package in the repo live, so the sweep also collapses packages the static
# DEVSTASH_IMAGES list doesn't name. `value(name)` returns the full resource path
# (projects/…/packages/<pkg>); the package segment is the last '/'-delimited field and may be
# URL-encoded (a nested path like foo%2Fbar) — leave it encoded since the docker image path uses
# the same encoding. Fall back to the static list if discovery returns nothing (repo empty or the
# packages API momentarily unavailable) so a listing hiccup can't silently skip the known images.
mapfile -t packages < <(gcloud artifacts packages list \
  --repository="$REPO" --location="$REGION" --project="$GCP_PROJECT_ID" \
  --format='value(name)' 2>/dev/null | sed 's#.*/##' | grep . || true)
if [[ ${#packages[@]} -eq 0 ]]; then
  echo "prune-registry: package discovery returned nothing — falling back to static image list"
  packages=("${DEVSTASH_IMAGES[@]}")
fi

for pkg in "${packages[@]}"; do
  image_path="${BASE}/${pkg}"
  if is_known_image "$pkg"; then
    # KNOWN runtime image: keep the SPECIFIC just-deployed digest. web -> WEB_DIGEST, etc.
    keep_var="$(printf '%s' "$pkg" | tr '[:lower:]-' '[:upper:]_')_DIGEST"
    keep_digest="${!keep_var:-}"
    if [[ -z "$keep_digest" ]]; then
      # Never prune a live image without knowing its deployed digest — that could delete the
      # image the cluster is currently serving. Skip (unchanged safety behaviour).
      echo "::warning::prune-registry: no keep digest (\$$keep_var) for known image '${pkg}'; skipping"
      continue
    fi
    prune_package "$image_path" "$keep_digest"
  else
    # EXTRA package (not a build target): keep the newest tagged index, delete the rest.
    keep_digest="$(newest_index_digest "$image_path")"
    if [[ -z "$keep_digest" ]]; then
      echo "prune-registry: no tagged index in extra package '${pkg}' — nothing to keep, skipping"
      continue
    fi
    echo "prune-registry: extra package '${pkg}' — keeping newest ${keep_digest}"
    prune_package "$image_path" "$keep_digest"
  fi
done
