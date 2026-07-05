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

# Skip the Helm upgrade if the release is already deployed at the pinned version. The skip-guard
# (and the helm-list/jq probe it wraps) is shared with ensure-reloader.sh via common.sh.
helm_skip_if_current external-secrets external-secrets "external-secrets-$ESO_VERSION" "External Secrets Operator"

# helm_repo (common.sh) single-sources the add+update pair shared with ensure-reloader.sh + run.sh.
helm_repo external-secrets https://charts.external-secrets.io

# Resource requests set to GKE Autopilot's 50m CPU minimum per container. The ESO chart
# defaults to 10m, which Autopilot silently mutates — explicit values here eliminate the
# mutation warning and make billing predictable.
#
# Failure policy comes from helm_failure_policy (common.sh) — "--atomic" by default (required
# for CI's Helm 3), overridable via HELM_FAILURE_POLICY (local run.sh sets --rollback-on-failure).
helm upgrade --install external-secrets external-secrets/external-secrets \
  -n external-secrets --create-namespace --wait --timeout 5m "$(helm_failure_policy)" \
  --version "$ESO_VERSION" \
  --set resources.requests.cpu=50m \
  --set resources.requests.memory=128Mi \
  --set certController.resources.requests.cpu=50m \
  --set certController.resources.requests.memory=128Mi \
  --set webhook.resources.requests.cpu=50m \
  --set webhook.resources.requests.memory=128Mi
