#!/usr/bin/env bash
# Sign every deployed digest for Binary Authorization (KMS-backed attestor, see
# modules/gke/main.tf). This is the CI half of "step 2" in that module's enforcement-path
# comment: attestations are proven to land BEFORE the cluster rule is ever switched from
# ALWAYS_ALLOW to REQUIRE_ATTESTATION. Hard-fails on error — enforcement is off, so a
# signing failure cannot brick a live deploy, but a silent failure would hide a broken
# pipeline from whoever eventually flips enforcement on. KMS does the signing; no private
# key ever touches the runner.
#
# The calling step gates on `vars.BINAUTHZ_ATTESTOR != ''`; validate-inputs.sh guarantees
# the three BINAUTHZ_* values are all-set-or-all-unset, so gating on the attestor alone is
# sufficient.
#
# Required env:
#   IMAGE_URI, WEB_DIGEST, MIGRATE_IMAGE          — from build-push.sh via $GITHUB_ENV
#                                                   (sign-images runs in the `build-push` job)
#   GCP_PROJECT_ID                                — attestor/keyversion project
#   BINAUTHZ_ATTESTOR, BINAUTHZ_KMS_KEYRING, BINAUTHZ_KMS_KEY
set -euo pipefail

for artifact in "${IMAGE_URI}@${WEB_DIGEST}" "${MIGRATE_IMAGE}"; do
  gcloud container binauthz attestations sign-and-create \
    --artifact-url="${artifact}" \
    --attestor="${BINAUTHZ_ATTESTOR}" \
    --attestor-project="${GCP_PROJECT_ID}" \
    --keyversion-project="${GCP_PROJECT_ID}" \
    --keyversion-location=global \
    --keyversion-keyring="${BINAUTHZ_KMS_KEYRING}" \
    --keyversion-key="${BINAUTHZ_KMS_KEY}" \
    --keyversion=1
done
