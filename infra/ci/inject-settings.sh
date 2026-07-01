#!/usr/bin/env bash
# Inject the real per-environment values into the overlay's single source of truth
# (settings.yaml). Kustomize `replacements` fan these out into the Workload-Identity SA
# annotation, ManagedCertificate domain, NEXTAUTH_URL, Ingress static-IP name, etc. The
# image is separate because its digest is build output, not environment config: pin
# `images` directly to THIS build's repo + immutable registry digest (not :latest), so the
# rendered Deployment is reproducible and the migrate→rollout gate is real. `yq` is
# preinstalled on ubuntu-latest runners.
#
# Required env:
#   GCP_PROJECT_ID, APP_DOMAIN, EMAIL_FROM       — always set by the caller
#   IMAGE_URI, WEB_DIGEST                        — from build-push.sh via $GITHUB_ENV
# Optional env (non-secret app config; empty/unset falls back to the committed value):
#   AUTH_GITHUB_ID, AUTH_GOOGLE_ID, STRIPE_PUBLISHABLE_KEY,
#   STRIPE_PRICE_ID_MONTHLY, STRIPE_PRICE_ID_YEARLY
#   ARMOR_ENABLED  — "true" attaches the Cloud Armor policy; anything else (incl. unset,
#                    the dev $0 default) injects an empty securityPolicy = no edge WAF.
set -euo pipefail

cd infra/k8s/overlays/gcp

# ingressIpName and armorPolicyName are derived from the Terraform name_prefix
# "devstash-dev" (locals.tf: "devstash-${var.environment}", environment default = "dev").
# The resource names are:
#   google_compute_global_address: "${name_prefix}-ip"     → "devstash-dev-ip"
#   google_compute_security_policy: "${name_prefix}-armor" → "devstash-dev-armor"
#
# WHY NOT `tofu output`: reading these from Terraform output at deploy time would require
# the OpenTofu state to be accessible in CI (remote state bucket auth, extra tofu init
# step). The values are stable — they only change when the `var.environment` tfvar or the
# Terraform name_prefix template changes, both of which require an intentional infra
# change. Hardcoding them here is an accepted tradeoff. WHEN TO UPDATE: if you rename
# `var.environment` in terraform.tfvars (e.g. "dev" → "prod"), update BOTH literals below
# AND the CLUSTER env var at the top of deploy-gke.yml to match. Mismatch = Ingress loses
# its static IP + BackendConfig gets no WAF policy — silent kubectl apply success.
# s3Bucket follows the same "derive, don't read Terraform state" approach: module.gcs
# .bucket_name's naming formula is "${project_id}-${name_prefix}-uploads"
# (modules/gcs/main.tf) — deterministic from GCP_PROJECT_ID, so no Secret Manager round-trip is
# needed for this non-secret bucket name. WHEN TO UPDATE: same trigger as above.
#
# The non-secret app config below (authGithubId/authGoogleId/stripe*) is OPTIONAL to
# override. GitHub Actions sets an undefined repo var to an EMPTY STRING (not unset), and
# yq's env() ERRORS on an empty var — so use strenv() (returns "" for empty/unset, no
# error) then `select(. != "")` to drop the empty value; yq's `//` then keeps the committed
# settings.yaml value. Set the repo var to override; leave it unset to deploy the committed
# default. (The values above use strenv() directly because their sources —
# GCP_PROJECT_ID/APP_DOMAIN/EMAIL_FROM — are always set.)
yq -i '
  .data.projectId            = strenv(GCP_PROJECT_ID) |
  .data.saEmail              = "devstash-app@" + strenv(GCP_PROJECT_ID) + ".iam.gserviceaccount.com" |
  .data.domain               = strenv(APP_DOMAIN) |
  .data.emailFrom            = strenv(EMAIL_FROM) |
  .data.nextAuthUrl          = "https://" + strenv(APP_DOMAIN) |
  .data.ingressIpName        = "devstash-dev-ip" |
  .data.armorPolicyName      = (strenv(ARMOR_ENABLED) == "true" ? "devstash-dev-armor" : "") |
  .data.s3Bucket             = strenv(GCP_PROJECT_ID) + "-devstash-dev-uploads" |
  .data.authGithubId         = ((strenv(AUTH_GITHUB_ID) | select(. != "")) // .data.authGithubId) |
  .data.authGoogleId         = ((strenv(AUTH_GOOGLE_ID) | select(. != "")) // .data.authGoogleId) |
  .data.stripePublishableKey = ((strenv(STRIPE_PUBLISHABLE_KEY) | select(. != "")) // .data.stripePublishableKey) |
  .data.stripePriceIdMonthly = ((strenv(STRIPE_PRICE_ID_MONTHLY) | select(. != "")) // .data.stripePriceIdMonthly) |
  .data.stripePriceIdYearly  = ((strenv(STRIPE_PRICE_ID_YEARLY) | select(. != "")) // .data.stripePriceIdYearly)
' settings.yaml

# Pin the web image to the immutable registry digest returned by BuildKit.
# WHY select(.name == "devstash") not .images[0]: positional index is fragile — if a
# sidecar or init-container image entry is ever prepended to the images list, index 0 would
# silently patch the wrong entry and leave the web container at :latest. Selecting by name
# is index-position-independent.
IMAGE_URI="${IMAGE_URI}" WEB_DIGEST="${WEB_DIGEST}" yq -i '
  (.images[] | select(.name == "devstash")) |= (
    .newName = strenv(IMAGE_URI) |
    .digest = strenv(WEB_DIGEST) |
    del(.newTag)
  )
' kustomization.yaml

echo "--- settings.yaml after injection ---"
cat settings.yaml
