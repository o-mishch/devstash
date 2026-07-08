#!/usr/bin/env bash
# Inject the real per-environment values into the overlay's single source of truth
# (settings.yaml). Kustomize `replacements` fan these out into the Workload-Identity SA
# annotation, the HTTPRoute host, the Gateway cert-map annotation + static-IP address,
# NEXTAUTH_URL, etc. The
# image is separate because its digest is build output, not environment config: pin
# `images` directly to THIS build's repo + immutable registry digest (not :latest), so the
# rendered Deployment is reproducible and the migrate→rollout gate is real. `yq` is
# preinstalled on ubuntu-latest runners.
#
# Required env:
#   GCP_PROJECT_ID, APP_DOMAIN, EMAIL_FROM       — always set by the caller
#   IMAGE_URI, WEB_DIGEST                        — job-level env in the `deploy` job,
#                                                  reconstructed from the `build-push` job's outputs
# Optional env (non-secret app config; empty/unset falls back to the committed value):
#   AUTH_GITHUB_ID, AUTH_GOOGLE_ID, STRIPE_PUBLISHABLE_KEY,
#   STRIPE_PRICE_ID_MONTHLY, STRIPE_PRICE_ID_YEARLY
#   ARMOR_ENABLED  — "true" attaches the Cloud Armor policy; anything else (incl. unset,
#                    the dev $0 default) leaves armorPolicyName empty. render-manifests.sh then
#                    DELETES the GCPBackendPolicy securityPolicy field post-render (an empty value
#                    is NOT "no policy" to GKE — it makes a malformed URL that fails the Gateway).
set -euo pipefail

# GCP_PROJECT_ID is REQUIRED, not optional (unlike the app-config vars below, which fall
# back to committed defaults on empty). It fills settings.yaml's projectId AND is spliced
# into saEmail. yq's strenv() returns "" for an unset var WITHOUT erroring under `set -u`,
# so a caller that forgets to pass it renders projectId="" and
# saEmail="devstash-app@.iam.gserviceaccount.com" — a malformed SA email that makes ESO's
# SecretStore fail InvalidProviderConfig ("Invalid form of account ID"), so the
# ExternalSecret never syncs and wait-secrets-sync.sh blocks its full timeout. That is
# exactly what happened when the render job was split out of `deploy` without carrying this
# var. Fail loudly here instead of emitting a poisoned manifest that stalls the deploy.
: "${GCP_PROJECT_ID:?must be set and non-empty; an empty value renders projectId= and saEmail=devstash-app@.iam.gserviceaccount.com, which breaks the ESO SecretStore}"

cd infra/k8s/overlays/gcp

# ingressIpName and armorPolicyName are derived from the Terraform name_prefix
# "devstash-dev" (locals.tf: "devstash-${var.environment}", environment default = "dev").
# The resource names are:
#   google_compute_global_address: "${name_prefix}-ip"     → "devstash-dev-ip"
#   google_compute_security_policy: "${name_prefix}-armor" → "devstash-dev-armor"
#   google_certificate_manager_certificate_map: "${name_prefix}-certmap" → "devstash-dev-certmap"
#
# WHY NOT `tofu output`: reading these from Terraform output at deploy time would require
# the OpenTofu state to be accessible in CI (remote state bucket auth, extra tofu init
# step). The values are stable — they only change when the `var.environment` tfvar or the
# Terraform name_prefix template changes, both of which require an intentional infra
# change. Hardcoding them here is an accepted tradeoff. WHEN TO UPDATE: if you rename
# `var.environment` in terraform.tfvars (e.g. "dev" → "prod"), update BOTH literals below
# AND the CLUSTER env var at the top of deploy-gke.yml to match. Mismatch = the Gateway loses
# its static IP + the GCPBackendPolicy points at the wrong WAF policy.
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
  .data.certMapName          = "devstash-dev-certmap" |
  .data.armorPolicyName      = ({"true": "devstash-dev-armor"} | .[strenv(ARMOR_ENABLED)] // "") |
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
