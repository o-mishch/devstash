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
# shellcheck source=infra/lib/common.sh
source "$(dirname "${BASH_SOURCE[0]}")/../lib/common.sh"

# Skip the Helm upgrade if the release is already deployed at the pinned version. The
# helm-list/jq probe is shared with ensure-reloader.sh via common.sh.
if helm_release_at_version external-secrets external-secrets "external-secrets-$ESO_VERSION"; then
  echo "External Secrets Operator version $ESO_VERSION is already installed. Skipping Helm upgrade."
  exit 0
fi

helm repo add external-secrets https://charts.external-secrets.io
helm repo update external-secrets

# Resource requests set to GKE Autopilot's 50m CPU minimum per container. The ESO chart
# defaults to 10m, which Autopilot silently mutates — explicit values here eliminate the
# mutation warning and make billing predictable.
#
# Failure policy is HELM_FAILURE_POLICY, defaulting to "--atomic". CRITICAL: the default
# must stay "--atomic" — the GitHub Actions runner (ubuntu-latest) runs Helm 3, which does
# NOT support "--rollback-on-failure" and fails the build; "--atomic" works on both Helm 3
# and Helm 4 (deprecated but functional). Local run.sh runs modern Helm and overrides this
# to "--rollback-on-failure" (the non-deprecated flag). Never hardcode the flag here.
HELM_FAILURE_POLICY="${HELM_FAILURE_POLICY:---atomic}"

helm upgrade --install external-secrets external-secrets/external-secrets \
  -n external-secrets --create-namespace --wait --timeout 5m "$HELM_FAILURE_POLICY" \
  --version "$ESO_VERSION" \
  --set resources.requests.cpu=50m \
  --set resources.requests.memory=128Mi \
  --set certController.resources.requests.cpu=50m \
  --set certController.resources.requests.memory=128Mi \
  --set webhook.resources.requests.cpu=50m \
  --set webhook.resources.requests.memory=128Mi
