variable "project_id" {
  type        = string
  description = "GCP project ID to deploy into (the project the live Cloud Run backend already runs in)."
}

# See dev/variables.tf's project_number comment — same static-input rationale (member strings
# derived from it, e.g. the default Compute Engine SA email, must stay plan-time known).
variable "project_number" {
  type        = string
  description = "Numeric GCP project number (gcloud projects describe <id> --format='value(projectNumber)')."
}

# us-central1 — matches dev's region (deliberately, per the region decision documented in the
# plan file), not the live service's current europe-west1/europe-southwest1. Cloud Run + the
# new Artifact Registry repo are freshly created here, not imported at their old region.
variable "region" {
  type        = string
  description = "GCP region for Cloud Run and Artifact Registry."
  default     = "us-central1"
}

variable "environment" {
  type        = string
  description = "Environment name, used in resource names + labels."
  default     = "prod"
}

variable "github_repository" {
  type        = string
  description = "GitHub repo permitted to deploy via WIF (Firebase Hosting deploys), \"owner/repo\" form."
  default     = "o-mishch/devstash"
}

variable "app_domain" {
  type        = string
  description = "Custom domain mapped to the Cloud Run backend."
  default     = "api.devstash.one"
}

variable "firebase_custom_domain" {
  type        = string
  description = "Transition subdomain served by Firebase Hosting (apex stays on Vercel until final cutover)."
  default     = "beta.devstash.one"
}

variable "cloud_run_min_instances" {
  type    = number
  default = 0
}

variable "cloud_run_max_instances" {
  type    = number
  default = 20
}

# The api.devstash.one → us-central1 mapping is a deliberate cutover step, not part of the
# initial stand-up (the domain is still mapped to the live europe-west1 service, and a domain
# maps to one service at a time). Keep false until the new service is healthy and the old
# mapping is deleted; then set true and re-apply. See the plan file's cutover runbook.
# Cutover DONE 2026-07-13: api.devstash.one now maps to the us-central1 service. Flipped true
# after both preconditions were met — us-central1 healthy (serving the ko-built image) and the
# old europe-west1 service + its mapping gone. (The mapping had actually vanished, taking
# api.devstash.one down; enabling this recreates it against us-central1.)
variable "enable_domain_mapping" {
  type    = bool
  default = true
}

# Bootstrap image for the FIRST apply only — the Cloud Run module's lifecycle.ignore_changes
# on the container image (modules/cloud-run/main.tf) means Terraform never fights the Cloud
# Build pipeline's subsequent `gcloud run services update` deploys. A public placeholder is
# fine here; the trigger's first real push replaces it within minutes of this landing.
variable "cloud_run_initial_image" {
  type    = string
  default = "us-docker.pkg.dev/cloudrun/container/hello"
}

# Backend Cloud Run env. Non-secret vars are plain `value`; ALL sensitive vars live inside the
# single consolidated APP_CONFIG secret (devstash-prod-config, see secrets.tf) — Cloud Run mounts
# that one secret into APP_CONFIG and backend/internal/config splits it back into DATABASE_URL,
# REDIS_URL, AUTH_*, RESEND_API_KEY, … at boot. One secret = one active version = Secret Manager
# free tier = $0. No secret VALUE ever lives in this file or in state (secret_data_wo).
variable "app_env_vars" {
  type = list(object({
    name           = string
    value          = optional(string)
    secret_name    = optional(string)
    secret_version = optional(string, "latest")
  }))
  default = [
    # Non-secret (plain). ALLOWED_ORIGINS/NEXT_PUBLIC_APP_URL = the transition SPA origin
    # (beta.devstash.one); the Vercel apex is NOT trusted here. EMAIL_FROM must be a
    # Resend-verified sender. API_BASE_URL = this service's own public origin, used to build
    # the OAuth redirect_uri (API_BASE_URL + /auth/oauth/{github,google}/callback) — the exact
    # value registered in the GitHub/Google OAuth app allowlists; distinct from
    # NEXT_PUBLIC_APP_URL (the SPA the callback 302s back to).
    { name = "ENV", value = "production" },
    { name = "ALLOWED_ORIGINS", value = "https://beta.devstash.one" },
    { name = "NEXT_PUBLIC_APP_URL", value = "https://beta.devstash.one" },
    { name = "API_BASE_URL", value = "https://api.devstash.one" },
    { name = "EMAIL_FROM", value = "DevStash <noreply@devstash.one>" },
    # Every sensitive var, as one JSON blob (config.go hydrateFromAppConfig splits it).
    { name = "APP_CONFIG", secret_name = "devstash-prod-config" },
  ]
}

# All sensitive backend env vars, JSON-encoded into the single devstash-prod-config secret
# (secrets.tf). Keys are env-var NAMES (DATABASE_URL, REDIS_URL, AUTH_SECRET, …); config.go's
# hydrateFromAppConfig splits them back into individual env vars at boot. Supplied via the
# gitignored terraform.tfvars — write-only (secret_data_wo), never stored in state.
variable "app_config" {
  type      = map(string)
  sensitive = true
}

# Matches the live trigger's filter EXACTLY. The Go-backend rewrite ships on the feature branch
# for the whole strangler period (main still serves the Vercel Next.js app), so the trigger keeps
# building this branch — deliberately NOT switched to ^main$. Kept identical to live so the import
# is zero-diff on the branch filter; only the build substitutions (region/repo) change.
variable "cloudbuild_branch_filter" {
  type    = string
  default = "^feature/go-backend-vite-spa$"
}

# The live trigger's actual, immutable resource name — an opaque slug Cloud Build's
# "Continuously deploy" console flow auto-generated (NOT a friendly chosen name). Verified via
# `gcloud builds triggers describe 9df333f5-0194-4213-bc85-d81fe3e0c64e --region=global`.
# Renaming would force a replace, so this must match exactly for the import to be zero-diff.
variable "cloudbuild_trigger_name" {
  type    = string
  default = "rmgpgab-devstash-europe-southwest1-o-mishch-devstash--featurmjg"
}
