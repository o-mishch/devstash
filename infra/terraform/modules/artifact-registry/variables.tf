variable "region" { type = string }

# Project the repo lives in. Passed in (not read from a data source) so the module's
# repository_url output can be built from static, always-knowable values — see outputs.tf.
variable "project_id" { type = string }

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
