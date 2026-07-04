#!/usr/bin/env bash
# Detect whether the dev environment is deep-suspended (its GKE cluster has been destroyed)
# so the deploy job can SKIP cleanly instead of:
#   (a) rebuilding + repushing images — which would repopulate the Artifact Registry that
#       `run.sh suspend` just purged and re-incur idle image storage, and
#   (b) then dying at "Get GKE credentials" against a cluster that no longer exists.
#
# Writes `suspended=true|false` to $GITHUB_OUTPUT. A suspended environment is an EXPECTED
# state (someone merged to main while the showcase is parked at ~$0), so the caller job
# surfaces it as a warning and self-skips — it is NOT a build failure. A genuine gcloud/auth
# error is deliberately NOT swallowed: the list runs under `set -e`, so an API failure fails
# this step loudly rather than being misread as "suspended" and silently skipping deploys.
#
# Resume is unaffected: run.sh resume recreates the cluster (apply + wait_for_cluster) BEFORE
# it dispatches this workflow, so by the time this check runs the environment is active again.
#
# Required env:
#   CLUSTER, REGION   — from the workflow-level env block
#   GCP_PROJECT_ID    — from secrets
set -euo pipefail

found="$(gcloud container clusters list \
  --project "$GCP_PROJECT_ID" --region "$REGION" \
  --filter="name=$CLUSTER" --format='value(name)')"

if [ -n "$found" ]; then
  echo "Environment active — GKE cluster '$CLUSTER' is present. Proceeding with build + deploy."
  echo "suspended=false" >> "$GITHUB_OUTPUT"
else
  echo "::warning::Environment is suspended — no GKE cluster '$CLUSTER'. Skipping build + deploy: no images are rebuilt or pushed, and nothing fails. Bring it back with: bash infra/run/gcp/run.sh resume"
  echo "suspended=true" >> "$GITHUB_OUTPUT"
fi
