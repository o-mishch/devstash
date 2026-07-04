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
# shellcheck source=infra/lib/common.sh
source "$(dirname "${BASH_SOURCE[0]}")/../lib/common.sh"

# Skip the Helm upgrade if the release is already deployed at the pinned version. The skip-guard
# (and the helm-list/jq probe it wraps) is shared with ensure-eso.sh via common.sh.
helm_skip_if_current reloader reloader "reloader-$RELOADER_VERSION" "Stakater Reloader"

helm repo add stakater https://stakater.github.io/stakater-charts
helm repo update stakater

# Resource requests set to Autopilot's 50m CPU floor. Failure policy comes from
# helm_failure_policy (common.sh) — same "--atomic" default and override as ensure-eso.sh.
helm upgrade --install reloader stakater/reloader \
  -n reloader --create-namespace --wait --timeout 5m "$(helm_failure_policy)" \
  --version "$RELOADER_VERSION" \
  --set reloader.deployment.resources.requests.cpu=50m \
  --set reloader.deployment.resources.requests.memory=128Mi
