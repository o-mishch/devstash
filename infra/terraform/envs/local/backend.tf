# Local-file state. envs/dev uses a GCS backend (durability, native locking, shared source
# of truth for CI + humans); the local env deliberately does NOT — a GCS backend would couple
# every `devstash-infra local up` to GCP auth and break offline use, and a Kubernetes backend is chicken-
# and-egg (the cluster this state creates must already exist to store the state). backend
# "local" keeps the partial-config bootstrap mechanism from envs/dev without any cloud
# dependency: OpenTofu takes an OS advisory file lock on the state file, so two concurrent
# applies can't corrupt it.
#
# Partial backend config: the state path is supplied by the devstash-infra CLI via
# `tofu init -backend-config=path=...` (kept out of git — see .gitignore), mirroring how
# envs/dev/backend.tf leaves the GCS bucket to be passed at init. For offline validation,
# `tofu init -backend=false` skips the backend entirely.
terraform {
  backend "local" {}
}
