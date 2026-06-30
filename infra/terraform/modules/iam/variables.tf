variable "project_id" { type = string }
variable "region" { type = string }
# GKE cluster name — used to scope container.developer to this cluster only.
variable "gke_cluster_name" { type = string }

variable "k8s_namespace" {
  type    = string
  default = "devstash"
}

variable "k8s_service_account" {
  type    = string
  default = "devstash"
}

variable "uploads_bucket_name" { type = string }
variable "artifact_registry_repository_id" { type = string }

# Binary Authorization attestor wiring (modules/gke outputs) — grants the deployer SA
# permission to sign attestations during CI, without granting it broader KMS/Container
# Analysis access than this one key/note.
variable "binauthz_note_id" { type = string }
variable "binauthz_kms_crypto_key_id" { type = string }

# GitHub repo allowed to federate as the deployer SA, "owner/repo" form.
variable "github_repository" {
  type        = string
  description = "GitHub repo permitted to deploy via WIF, e.g. \"my-org/devstash\"."
}

# Numeric GitHub account/org ID of the repo owner. Pinning the immutable owner ID
# (not just the name) is what stops a renamed/look-alike repo from federating.
# Find it: https://api.github.com/users/<owner> -> "id".
variable "github_owner_id" {
  type        = string
  description = "Numeric GitHub owner (user/org) ID for the WIF attribute_condition."
}

# Map of secret short-name -> value. Stored in Secret Manager, read by the app SA.
variable "app_secrets" {
  type      = map(string)
  sensitive = true
  default   = {}
}

variable "labels" {
  type    = map(string)
  default = {}
}
