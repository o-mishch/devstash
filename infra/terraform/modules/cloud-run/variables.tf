variable "project_id" { type = string }
variable "region" { type = string }

variable "name" {
  type    = string
  default = "devstash"
}

# Full image reference (repo/path:tag or @sha256 digest). Only matters at first-create —
# `lifecycle.ignore_changes` (main.tf) hands ongoing image updates to the Cloud Build pipeline.
variable "image" { type = string }

variable "min_instance_count" {
  type    = number
  default = 0
}

variable "max_instance_count" {
  type    = number
  default = 20
}

# Empty string = let Cloud Run use the project's default Compute Engine service account
# (main.tf omits the field entirely in that case). Matches the live service's current
# identity — moving to a dedicated least-privilege SA is a deliberate follow-up, not bundled
# with import (see envs/prod's plan notes).
variable "service_account_email" {
  type    = string
  default = ""
}

# Each entry is either a plain value OR a Secret Manager reference (set secret_name). Exactly
# one of `value` / `secret_name` should be set per entry — secret_name wins in main.tf if both
# are given. Mirrors Cloud Run v2's native env: plain `value` vs `value_source.secret_key_ref`.
variable "env" {
  type = list(object({
    name           = string
    value          = optional(string)
    secret_name    = optional(string)
    secret_version = optional(string, "latest")
  }))
  default = []
}

variable "cpu" {
  type    = string
  default = "1"
}

variable "memory" {
  type    = string
  default = "512Mi"
}

variable "cpu_idle" {
  type    = bool
  default = true
}

variable "startup_cpu_boost" {
  type    = bool
  default = false
}

variable "ingress" {
  type    = string
  default = "INGRESS_TRAFFIC_ALL"
}

# Grant allUsers roles/run.invoker so unauthenticated (browser) traffic reaches the service — the
# app enforces its own session auth. Default false (safe); a public API sets it true. See main.tf.
variable "allow_unauthenticated" {
  type    = bool
  default = false
}

# Prod default true (see main.tf). Dev/ephemeral callers would set this false.
variable "deletion_protection" {
  type    = bool
  default = true
}

variable "labels" {
  type    = map(string)
  default = {}
}

# Custom domain to map onto this service, e.g. "api.devstash.one". Empty string skips creating
# a domain mapping entirely.
variable "domain" {
  type    = string
  default = ""
}

# Whether to actually create the domain mapping. Separate from `domain` so the service can be
# created + verified before the domain is cut over (a domain maps to only one service at a time).
variable "create_domain_mapping" {
  type    = bool
  default = true
}
