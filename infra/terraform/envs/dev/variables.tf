variable "project_id" {
  type        = string
  description = "GCP project ID to deploy into."
}

variable "region" {
  type        = string
  description = "GCP region for GKE, Memorystore, and GCS. Must match deploy-gke.yml. GCS Always Free applies only in us-west1, us-central1, or us-east1."
  default     = "us-central1"
}

variable "environment" {
  type        = string
  description = "Environment name, used in resource names + labels."
  default     = "dev"
}

# GitHub repo allowed to deploy via Workload Identity Federation (keyless CI).
variable "github_repository" {
  type        = string
  description = "GitHub repo permitted to deploy via WIF, \"owner/repo\" form."
}

variable "github_owner_id" {
  type        = string
  description = "Numeric GitHub owner (user/org) ID — pins the WIF condition to an immutable identity. Get it from https://api.github.com/users/<owner>."
}

# App domain — drives the Google-managed cert + NEXTAUTH_URL in overlays/gcp.
# DNS A-record for this domain must point at the Ingress static IP (network module).
variable "app_domain" {
  type        = string
  description = "Public hostname for the app, e.g. \"devstash.example.com\"."
}

# Sender identity for transactional email — non-secret, drives EMAIL_FROM in the
# devstash-config ConfigMap (infra/k8s/overlays/gcp/kustomization.yaml).
variable "email_from" {
  type        = string
  description = "\"From\" address for transactional email, e.g. \"DevStash <noreply@devstash.one>\"."
}

# Third-party credentials (Stripe, Resend, OAuth, OpenAI, auth-secret) that Terraform
# cannot derive — supplied via the gitignored terraform.tfvars. Each key K becomes
# Secret Manager secret `devstash-K`, granted to the app SA, and consumed by the
# ESO ExternalSecret (infra/k8s/overlays/gcp/external-secrets.yaml). See
# infra/docs/08-gcp-bootstrap.md §7b. Keys use kebab-case (e.g. "stripe-secret-key").
# NOTE: database-url/direct-url/redis-url are NOT here — Terraform derives them from
# the managed Cloud SQL + Memorystore modules.
# NOTE: email-from is NOT here — it is a non-secret constant (see var.email_from above).
#
# SENSITIVE MAP SEMANTICS (do not change without reading this):
# - `sensitive = true` on a map(string) redacts ALL values in plan/apply CLI output.
#   This is DISPLAY-ONLY: values are still stored in plain text in terraform.tfstate.
#   The real protection is the GCS backend with CMEK encryption. Never print state.
# - The entire map (and any expression derived from it via merge/lookup/[]) inherits
#   the sensitive taint. The IAM module uses `nonsensitive(keys(...))` for for_each
#   and accesses values inside resource bodies only — this is the correct pattern.
# - `default = {}`: if terraform.tfvars is absent, tofu plan will FAIL immediately on
#   the required-keys validation below (empty map → all required keys missing). This
#   gives a clear validation error rather than a generic "variable not set" error.
variable "third_party_secrets" {
  type        = map(string)
  sensitive   = true
  default     = {}
  description = "Real 3rd-party creds → Secret Manager. From terraform.tfvars only."

  # external-secrets.yaml references every key below unconditionally. Letting an
  # incomplete map reach apply creates healthy infrastructure but an ExternalSecret
  # that never becomes Ready, so CI times out before migrations. Fail at plan time.
  #
  # VALIDATION PATTERN: setsubtract(required_set, actual_keys) returns required keys
  # that are MISSING from the provided map. length == 0 means all required keys are
  # present. Argument order matters: setsubtract(A, B) = elements in A not in B.
  validation {
    condition = length(setsubtract(toset([
      "auth-secret",
      "auth-github-id",
      "auth-github-secret",
      "auth-google-id",
      "auth-google-secret",
      "resend-api-key",
      # "email-from" is intentionally absent — it is a non-secret constant promoted
      # to var.email_from and lives in the devstash-config ConfigMap, not Secret Manager.
      "stripe-secret-key",
      "stripe-publishable-key",
      "stripe-webhook-secret",
      "stripe-price-id-monthly",
      "stripe-price-id-yearly",
      "openai-api-key",
    ]), toset(keys(var.third_party_secrets)))) == 0
    error_message = "third_party_secrets is missing one or more keys required by infra/k8s/overlays/gcp/external-secrets.yaml."
  }

  validation {
    condition     = alltrue([for value in values(var.third_party_secrets) : trimspace(value) != ""])
    error_message = "third_party_secrets values must not be empty."
  }

  validation {
    condition = alltrue([
      for value in values(var.third_party_secrets) :
      !strcontains(value, "...") && !strcontains(value, "openssl rand")
    ])
    error_message = "third_party_secrets still contains a terraform.tfvars.example placeholder."
  }
}

# Database: managed Cloud SQL for PostgreSQL (modules/cloudsql).
variable "db_tier" {
  type        = string
  description = "Cloud SQL machine tier. db-f1-micro is the cheapest (shared-core) for dev; only valid on ENTERPRISE edition. If org policy forces ENTERPRISE_PLUS, use db-perf-optimized-N-2."
  default     = "db-f1-micro"
}

# CIDRs allowed to reach the Cloud SQL PUBLIC IP for direct developer access
# (psql/GUI). Empty by default — add your laptop's IP in terraform.tfvars, e.g.
# [{ name = "home", value = "203.0.113.4/32" }]. SSL is required regardless.
variable "db_authorized_networks" {
  type = list(object({
    name  = string
    value = string
  }))
  default = []
}

# Cloud SQL HA — standby replica in a second zone. Doubles SQL instance cost but
# gives automatic failover. Recommended for production; off by default for dev.
variable "db_highly_available" {
  type        = bool
  default     = false
  description = "Enable Cloud SQL high-availability (regional) mode. Doubles instance cost; recommended for production."
}

# Memorystore HA — STANDARD_HA tier adds a replica node.
# Without HA, the instance is BASIC (single node). Enable for production.
variable "memory_highly_available" {
  type        = bool
  default     = false
  description = "Enable Memorystore STANDARD_HA tier (replica node). Recommended for production."
}

variable "armor_waf_preview" {
  type        = bool
  default     = true
  description = "Preview Cloud Armor SQLi/XSS matches without blocking. Set false only after reviewing load-balancer logs for false positives."
}

# Protection is environment policy, not module source code. Keep true for normal
# plans. Set false in terraform.tfvars, apply that reviewed change, and only then
# destroy; both GKE and Cloud SQL require false to be recorded in state before delete.
variable "deletion_protection" {
  type        = bool
  default     = true
  description = "Protect GKE and Cloud SQL from deletion. Disable via tfvars and apply before intentional teardown."
}

# GKE Autopilot: no node VM variables — Google manages nodes; pay per pod.
