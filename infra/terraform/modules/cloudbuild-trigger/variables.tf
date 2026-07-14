variable "project_id" { type = string }

# Cloud Build triggers are regional resources, but "global" is a valid and common location —
# matches the live trigger's registration.
variable "location" {
  type    = string
  default = "global"
}

# The trigger's actual resource name. NOT a friendly default — Cloud Build's "Continuously
# deploy" console flow auto-generates an opaque slug (e.g.
# "rmgpgab-devstash-europe-southwest1-o-mishch-devstash--featurmjg") for the live trigger, and
# this field is immutable (changing it forces a replace). Must be supplied from the live
# resource's real name (`gcloud builds triggers describe <id> --region=global`) for the import
# to succeed without a replace.
variable "trigger_name" { type = string }

variable "description" {
  type    = string
  default = ""
}

variable "github_owner" {
  type    = string
  default = "o-mishch"
}

# The GitHub repository name (not "owner/repo" — just the repo part).
variable "github_repo_name" {
  type    = string
  default = "devstash"
}

variable "branch_filter_regex" {
  type    = string
  default = "^main$"
}

# Glob(s) that scope the trigger to a subtree, so a push touching only the *other* track's
# files doesn't fire this build (e.g. web-only commit must not rebuild the backend, and vice
# versa). Empty (default) preserves the original "fire on any file" behaviour.
variable "included_files" {
  type    = list(string)
  default = []
}

# Service account that runs the build (bare email — main.tf builds the
# projects/{project}/serviceAccounts/{email} resource-path form from it).
variable "deployer_service_account" { type = string }

variable "substitutions" {
  type    = map(string)
  default = {}
}

# One entry per Cloud Build step. `entrypoint` is optional (defaults to the image's own
# entrypoint, e.g. the docker builder or the firebase image's `firebase`); `dir` is optional
# (working directory under /workspace — set to "web" so npm/firebase steps run where
# package.json + firebase.json live); `args` is required. `env` is optional — a list of
# "KEY=value" strings injected into that step's environment (e.g. build-time VITE_* vars).
variable "build_steps" {
  type = list(object({
    id         = string
    name       = string
    entrypoint = optional(string)
    dir        = optional(string)
    args       = list(string)
    env        = optional(list(string))
  }))
}

# Matches the live trigger's setting; INCLUDE_BUILD_LOGS_WITH_STATUS attaches build logs to the
# GitHub commit status. Only valid for GitHub-App triggers (which this is).
variable "include_build_logs" {
  type    = string
  default = "INCLUDE_BUILD_LOGS_WITH_STATUS"
}

variable "build_images" {
  type    = list(string)
  default = []
}

variable "tags" {
  type    = list(string)
  default = []
}
