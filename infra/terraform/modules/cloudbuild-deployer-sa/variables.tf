variable "project_id" { type = string }

# Numeric project number — builds the Cloud Build service agent email
# (service-<number>@gcp-sa-cloudbuild.iam.gserviceaccount.com) granted token-creator on the SA.
variable "project_number" { type = string }

variable "account_id" { type = string }

variable "display_name" { type = string }

# Workload-specific PROJECT-level roles to grant beyond the always-required logging.logWriter
# (e.g. ["roles/run.developer"] or ["roles/firebasehosting.admin","roles/serviceusage.apiKeysViewer"]).
# Resource- or SA-scoped grants (repo-scoped Artifact Registry, actAs on a runtime SA) are NOT
# project roles — the caller defines those against the `email` output.
variable "project_roles" {
  type    = list(string)
  default = []
}
