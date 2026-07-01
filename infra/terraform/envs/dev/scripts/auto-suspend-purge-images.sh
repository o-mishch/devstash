#!/bin/sh
# Cloud Build step 5 — PURGE IMAGES (only if idle; see auto-suspend.tf). $_VAR values are Cloud
# Build substitutions mapped onto the step env — the `script` field doesn't expand them in
# content — so plain POSIX shell. Deletes the images named in $_IMAGES
# (web + migrate, sourced from auto-suspend.tf local.devstash_images, itself mirroring
# infra/lib/common.sh) — every version + tag, including the :buildcache layers — from
# Artifact Registry so a deep-suspended env holds ZERO image storage, the last standing cost
# above the always-free tier. Safe because a resume rebuilds and repushes from source via CI
# (run.sh resume → deploy → the deploy-gke workflow) BEFORE the Deployment is applied, and
# the k8s Deployment pins images by digest that CI has just produced. This runs AFTER the
# tofu suspend (env already down), so image ops are off the critical dump→destroy path.
#
# Best-effort: a purge failure (e.g. repo already empty) must NOT fail the suspend build —
# the environment is already at ~$0 compute-wise and the AR cleanup_policies also trim
# images over time. Log and continue.
set -eu
[ -f /workspace/SUSPEND ] || { echo "not idle — skipping image purge"; exit 0; }
BASE="$_REGION-docker.pkg.dev/$_PROJECT_ID/$_AR_REPO"
for img in $_IMAGES; do
  echo "Purging $BASE/$img (all versions + tags) from Artifact Registry"
  gcloud artifacts docker images delete "$BASE/$img" \
    --delete-tags --quiet --project="$_PROJECT_ID" \
    || echo "purge of $img returned non-zero (likely already empty) — continuing"
done
echo "image purge complete — Artifact Registry storage reclaimed for \$0 idle"
