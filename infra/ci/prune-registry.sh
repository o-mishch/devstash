#!/usr/bin/env bash
# Post-rollout prune: keep ONLY the just-deployed version per image, delete every older one
# IMMEDIATELY. The keep-recent (keep_count=1) cleanup policy on the repository already does
# the same thing, but only on Artifact Registry's ~daily ASYNC sweep; this makes the deletion
# happen the moment a deploy is proven healthy. Runs AFTER wait-rollout.sh, so no previous
# version is still being served.
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

for img in "${DEVSTASH_IMAGES[@]}"; do
  image_path="${BASE}/${img}"
  # Resolve the keep digest from the per-image env var: web -> WEB_DIGEST, migrate -> MIGRATE_DIGEST.
  keep_var="$(printf '%s' "$img" | tr '[:lower:]-' '[:upper:]_')_DIGEST"
  keep="${!keep_var:-}"
  if [[ -z "$keep" ]]; then
    # Never prune without a keep digest — that would delete the image we just shipped.
    echo "::warning::prune-registry: no keep digest (\$$keep_var) for '${img}'; skipping"
    continue
  fi

  echo "prune-registry: ${image_path} — keeping ${keep}, deleting older tagged versions"
  # List every version with its tags (tab-separated; tags are ';'-joined). Untagged
  # children/attestations come back with an empty tags column and are skipped.
  while IFS=$'\t' read -r version tags; do
    [[ -z "${tags:-}" ]] && continue        # untagged manifest — never delete directly
    [[ "$version" == "$keep" ]] && continue  # the just-deployed index — keep
    echo "prune-registry: deleting superseded ${image_path}@${version} (tags: ${tags})"
    if ! gcloud artifacts docker images delete "${image_path}@${version}" \
         --delete-tags --quiet --project="$GCP_PROJECT_ID"; then
      echo "::warning::prune-registry: failed to delete ${image_path}@${version} (continuing)"
    fi
  done < <(gcloud artifacts docker images list "$image_path" \
             --include-tags --format="value(version,tags)" \
             --project="$GCP_PROJECT_ID" 2>/dev/null || true)
done
