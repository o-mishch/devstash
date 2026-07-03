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

# Calculate the cutoff time (30 minutes ago) in UTC to protect recent images
# from being deleted by concurrent/overlapping GHA runs.
if date --version &>/dev/null; then
  # GNU date (Linux GHA runner)
  CUTOFF=$(date -u -d "30 minutes ago" +"%Y-%m-%dT%H:%M:%SZ")
else
  # BSD date (macOS local runs)
  CUTOFF=$(date -v-30M -u +"%Y-%m-%dT%H:%M:%SZ")
fi

for img in "${DEVSTASH_IMAGES[@]}"; do
  image_path="${BASE}/${img}"
  # Resolve the keep digest from the per-image env var: web -> WEB_DIGEST, migrate -> MIGRATE_DIGEST.
  keep_var="$(printf '%s' "$img" | tr '[:lower:]-' '[:upper:]_')_DIGEST"
  keep_digest="${!keep_var:-}"
  if [[ -z "$keep_digest" ]]; then
    # Never prune without a keep digest — that would delete the image we just shipped.
    echo "::warning::prune-registry: no keep digest (\$$keep_var) for '${img}'; skipping"
    continue
  fi

  echo "prune-registry: ${image_path} — keeping ${keep_digest} and its children"

  # Protect both the parent index digest and all child digests referenced by the index
  # (e.g. platform manifests, SBOM, provenance).
  keep_list=" ${keep_digest} "
  if children=$(docker manifest inspect "${image_path}@${keep_digest}" | jq -r 'if .manifests then .manifests[].digest else empty end' 2>/dev/null); then
    for child in $children; do
      keep_list="${keep_list}${child} "
      echo "prune-registry: protecting child manifest ${child}"
    done
  fi

  # Pass 1: delete OCI Indexes (parent manifests) first to unreference child manifests.
  while IFS=$'\t' read -r version media_type; do
    [[ -z "${version}" ]] && continue
    if [[ "$media_type" != *"index"* ]]; then
      continue
    fi
    case " $keep_list " in
      *" ${version} "*)
        echo "prune-registry: keeping active index ${image_path}@${version}"
        continue
        ;;
    esac

    echo "prune-registry: deleting superseded index ${image_path}@${version}"
    if ! gcloud artifacts docker images delete "${image_path}@${version}" \
         --delete-tags --quiet --project="$GCP_PROJECT_ID"; then
      echo "::warning::prune-registry: failed to delete ${image_path}@${version} (continuing)"
    fi
  done < <(gcloud artifacts docker images list "$image_path" \
             --filter="createTime < $CUTOFF" \
             --format="value(version,metadata.mediaType)" \
             --project="$GCP_PROJECT_ID" 2>/dev/null || true)

  # Pass 2: delete any remaining manifests (child/attestation manifests) that are not kept.
  while IFS=$'\t' read -r version media_type; do
    [[ -z "${version}" ]] && continue
    if [[ "$media_type" == *"index"* ]]; then
      continue
    fi
    case " $keep_list " in
      *" ${version} "*)
        echo "prune-registry: keeping active manifest ${image_path}@${version}"
        continue
        ;;
    esac

    echo "prune-registry: deleting superseded/orphaned manifest ${image_path}@${version}"
    if ! gcloud artifacts docker images delete "${image_path}@${version}" \
         --delete-tags --quiet --project="$GCP_PROJECT_ID"; then
      echo "::warning::prune-registry: failed to delete ${image_path}@${version} (continuing)"
    fi
  done < <(gcloud artifacts docker images list "$image_path" \
             --filter="createTime < $CUTOFF" \
             --format="value(version,metadata.mediaType)" \
             --project="$GCP_PROJECT_ID" 2>/dev/null || true)
done
