#!/usr/bin/env bash
# The GCP overlay ships an ESO SecretStore + ExternalSecret (Secret Manager →
# devstash-secrets). Their CRDs must exist before `apply -k`. Install/upgrade External
# Secrets Operator idempotently — a no-op on clusters that already have it. --version is
# read from infra/versions.env (single source of truth shared with run.sh). Update the
# version there to bump both CI and the bootstrap script together.
#
# Run from the repo root (sources infra/versions.env by relative path).
set -euo pipefail

# shellcheck source=infra/versions.env
source infra/versions.env

helm repo add external-secrets https://charts.external-secrets.io
helm repo update external-secrets

# Resource requests set to GKE Autopilot's 50m CPU minimum per container. The ESO chart
# defaults to 10m, which Autopilot silently mutates — explicit values here eliminate the
# mutation warning and make billing predictable.
#
# CRITICAL: Do NOT use "--rollback-on-failure". GitHub Actions runner (ubuntu-latest) runs
# Helm 3 which does not support it and fails the build. Use "--atomic" which is supported
# in both Helm 3 and Helm 4 (deprecated but functional).
helm upgrade --install external-secrets external-secrets/external-secrets \
  -n external-secrets --create-namespace --wait --timeout 5m --atomic \
  --version "$ESO_VERSION" \
  --set resources.requests.cpu=50m \
  --set resources.requests.memory=128Mi \
  --set certController.resources.requests.cpu=50m \
  --set certController.resources.requests.memory=128Mi \
  --set webhook.resources.requests.cpu=50m \
  --set webhook.resources.requests.memory=128Mi
