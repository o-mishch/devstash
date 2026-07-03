#!/bin/sh
# Cloud Build step 5 — DELETE REGISTRY (only if idle; see auto-suspend.tf). $_VAR values are
# Cloud Build substitutions mapped onto the step env — the `script` field doesn't expand them
# in content — so plain POSIX shell. Deletes the ENTIRE Artifact Registry repository named in
# $_AR_REPO (every image, version, tag, and :buildcache layer it holds) so a deep-suspended
# env holds ZERO image storage AND no lingering repo — the last cost above the always-free
# tier. Safe because `run.sh resume` runs a full-refresh `tofu apply` that RECREATES the repo
# (it's TF-managed, ungated on environment_active) and CI then rebuilds + repushes from source
# BEFORE the Deployment is applied; the k8s Deployment pins images by the digest CI just
# produced. This runs AFTER the tofu suspend (env already down), so registry ops are off the
# critical dump→destroy path.
#
# Best-effort: a delete failure (e.g. repo already gone) must NOT fail the suspend build — the
# environment is already at ~$0 compute-wise. Log and continue.
set -eu
[ -f /workspace/SUSPEND ] || { echo "not idle — skipping registry delete"; exit 0; }
echo "Deleting Artifact Registry repository $_AR_REPO (all images + tags) for \$0 idle"
gcloud artifacts repositories delete "$_AR_REPO" \
  --location="$_REGION" --quiet --project="$_PROJECT_ID" \
  || echo "repository delete returned non-zero (likely already deleted) — continuing"
echo "registry delete complete — Artifact Registry reclaimed for \$0 idle; resume recreates it"
