#!/usr/bin/env bash
# Stakater Reloader: watches Secrets/ConfigMaps and rolls Deployments when their data
# changes. Required for secret.reloader.stakater.com/reload annotations (set on the web
# Deployment) to take effect — without Reloader the annotation is inert and ESO-refreshed
# secrets only propagate on the next manual deploy. --version is read from
# infra/versions.env (single source of truth shared with run.sh).
#
# Run from the repo root (sources infra/versions.env by relative path).
set -euo pipefail

# shellcheck source=infra/versions.env
source infra/versions.env

# Check if already installed with the correct version
if command -v jq &>/dev/null && command -v helm &>/dev/null; then
  CURRENT_CHART=$(helm list -n reloader -o json 2>/dev/null | jq -r '.[] | select(.name=="reloader" and .status=="deployed") | .chart' 2>/dev/null || true)
  if [[ "$CURRENT_CHART" == "reloader-$RELOADER_VERSION" ]]; then
    echo "Stakater Reloader version $RELOADER_VERSION is already installed. Skipping Helm upgrade."
    exit 0
  fi
fi

helm repo add stakater https://stakater.github.io/stakater-charts
helm repo update stakater

# Resource requests set to Autopilot's 50m CPU floor. Failure policy is HELM_FAILURE_POLICY
# — same rationale and default as ensure-eso.sh; see the note there.
HELM_FAILURE_POLICY="${HELM_FAILURE_POLICY:---atomic}"

helm upgrade --install reloader stakater/reloader \
  -n reloader --create-namespace --wait --timeout 5m "$HELM_FAILURE_POLICY" \
  --version "$RELOADER_VERSION" \
  --set reloader.deployment.resources.requests.cpu=50m \
  --set reloader.deployment.resources.requests.memory=128Mi
