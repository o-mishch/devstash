variable "project_id" { type = string }
# Numeric project number. Passed in statically (not read via data.google_project inside this
# module) so the compute-default-SA member string below stays PLAN-TIME KNOWN. Under the
# auto-suspend's `-refresh=false` apply, a data.google_project read is deferred to apply time,
# which makes any member derived from it "unknown" and forces a REPLACE of the IAM binding —
# and the destroy half of that replace needs resourcemanager.projects.setIamPolicy / bucket
# getIamPolicy the least-privilege lifecycle SA deliberately lacks, 403-ing the suspend after
# the cheap resources are already gone. Same static-derivation fix as gke_node_sa_email.
variable "project_number" { type = string }
variable "region" { type = string }

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

# ORDERING-ONLY dependency handle on the Artifact Registry repo resource. The 3 repo-scoped AR
# IAM members below target the STATIC artifact_registry_repository_id string, so without this the
# graph has no edge to the repo and the suspend destroy races them: the repo is destroyed first,
# then the member destroys 403 on the vanished repo (getIamPolicy/setIamPolicy on an absent
# resource returns 403), aborting the apply before the GKE destroy — the cluster stays billing.
# Threading the repo resource here as a depends_on target forces the members to destroy BEFORE
# the repo (depends_on edges reverse on destroy). Consumed ONLY in depends_on, never as a value,
# so it does not make any member string plan-time-unknown under the -refresh=false suspend apply.
# Defaults to [] so callers that don't wire it (or the suspended count=0 case) still plan.
variable "artifact_registry_repository_depends_on" {
  type    = set(any)
  default = []
}

# Whether the environment is active (vs deep-suspended). Gates the repo-scoped Artifact
# Registry READER bindings: the AR repo is destroyed on suspend, and a repo-scoped IAM
# binding cannot outlive its repo, so these bindings track the repo's existence. The node
# SA's PROJECT-LEVEL bindings stay always-on regardless (see envs/dev/main.tf) — only the
# repo-scoped grants gate here.
variable "environment_active" {
  type    = bool
  default = true
}

# Binary Authorization attestor wiring (modules/gke outputs) — grants the deployer SA
# permission to sign attestations during CI, without granting it broader KMS/Container
# Analysis access than this one key/note. Both are null when the pipeline is disabled
# (var.binauthz_enabled = false); the grants that consume them are gated by the same flag.
variable "binauthz_enabled" {
  type        = bool
  default     = false
  description = "Grant the deployer SA the KMS-signer + note-attacher roles for the attestor. Must match modules/gke binauthz_enabled."
}
variable "binauthz_note_id" {
  type    = string
  default = null
}
variable "binauthz_kms_crypto_key_id" {
  type    = string
  default = null
}

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

variable "gke_node_sa_email" {
  type        = string
  default     = ""
  description = "Service account email of the GKE nodes."
}

