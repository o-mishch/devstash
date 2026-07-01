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

helm repo add stakater https://stakater.github.io/stakater-charts
helm repo update stakater

# Resource requests set to Autopilot's 50m CPU floor, and --atomic (NOT
# --rollback-on-failure) — same rationale as ensure-eso.sh; see the note there.
helm upgrade --install reloader stakater/reloader \
  -n reloader --create-namespace --wait --timeout 5m --atomic \
  --version "$RELOADER_VERSION" \
  --set reloader.deployment.resources.requests.cpu=50m \
  --set reloader.deployment.resources.requests.memory=128Mi
