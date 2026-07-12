variable "region" { type = string }

# Project the repo lives in. Passed in (not read from a data source) so the module's
# repository_url output can be built from static, always-knowable values — see outputs.tf.
variable "project_id" { type = string }

# Repo id/name. Defaults to dev's historical constant ("devstash") so existing dev callers
# need no change. Prod passes "devstash-prod" — its own fresh us-central1 repo (dev's "devstash"
# repo is create = environment_active, destroyed on every dev suspend, so unshareable).
variable "repository_id" {
  type    = string
  default = "devstash"
}

# How many most-recent tagged versions the keep-recent policy retains. Dev deliberately trades
# away rollback depth (1 — ephemeral, suspend/resume rebuilds from CI); prod should raise this
# so a Cloud Run rollback can reach back further than "the last push".
variable "keep_count" {
  type    = number
  default = 1
}

# How long (seconds) the keep-young policy protects newly-tagged images regardless of count, so
# a rapid-push burst can't evict an image a consumer is mid-pull on. Dev uses 1 day (86400); a
# prod environment without dev's suspend/resume churn can afford a shorter or longer window.
variable "keep_young_seconds" {
  type    = number
  default = 86400
}

# Gate the repo on the environment's active state. When false (deep-suspend), the repo
# resource is destroyed by the same `-refresh=false` suspend apply that tears down compute
# + Cloud SQL, so idle Artifact Registry storage is $0. Resume (create=true) recreates it and
# CI repushes images before the Deployment. The repository_id/url outputs are STATIC (derived
# from the known name, not the resource attribute) so every consumer resolves whether the repo
# exists or not — the root repository_url output and the IAM module's binding target must not
# break while suspended.
variable "create" {
  type    = bool
  default = true
}

variable "labels" {
  type    = map(string)
  default = {}
}
