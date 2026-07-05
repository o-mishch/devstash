#!/usr/bin/env bash
# Fail the deploy BEFORE image builds or GCP auth if a required GitHub deployment
# input is missing. Empty GitHub secrets/variables expand to empty strings; without
# this guard the failures surface much later as malformed image names, STS errors,
# or a Gateway/HTTPRoute with an empty host or cert map.
#
# Required env (from the calling workflow step's `env:` block):
#   GCP_PROJECT_ID, WORKLOAD_IDENTITY_PROVIDER, DEPLOYER_SA, APP_DOMAIN
# Optional env (Binary Authorization — all three set together, or all unset):
#   BINAUTHZ_ATTESTOR, BINAUTHZ_KMS_KEYRING, BINAUTHZ_KMS_KEY
set -euo pipefail

for name in GCP_PROJECT_ID WORKLOAD_IDENTITY_PROVIDER DEPLOYER_SA APP_DOMAIN; do
  if [[ -z "${!name:-}" ]]; then
    echo "::error::Required GitHub deployment input is missing: ${name}"
    exit 1
  fi
done

# Binary Authorization is optional (binauthz_enabled=false in the dev $0 posture leaves
# these repo variables unset and the signing step self-skips). But a PARTIAL config is a
# bug: if the attestor is set, the keyring + key must be too, or signing would fail
# mid-deploy. Enforce all-or-nothing.
if [[ -n "${BINAUTHZ_ATTESTOR:-}" || -n "${BINAUTHZ_KMS_KEYRING:-}" || -n "${BINAUTHZ_KMS_KEY:-}" ]]; then
  for name in BINAUTHZ_ATTESTOR BINAUTHZ_KMS_KEYRING BINAUTHZ_KMS_KEY; do
    if [[ -z "${!name:-}" ]]; then
      echo "::error::Binary Authorization is partially configured — ${name} is missing (set all three, or none)"
      exit 1
    fi
  done
fi

if [[ ! "$APP_DOMAIN" =~ ^[a-z0-9]([a-z0-9.-]*[a-z0-9])?$ || "$APP_DOMAIN" != *.* ]]; then
  echo "::error::APP_DOMAIN must be a lowercase hostname without scheme, port, or path"
  exit 1
fi
