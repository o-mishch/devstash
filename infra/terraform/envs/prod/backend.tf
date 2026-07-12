# Same GCS-remote-state rationale as dev (see dev/backend.tf): durability, native locking, a
# shared source of truth. Partial config — bucket is globally unique and supplied via
# `-backend-config` at `tofu init` time, not hardcoded (this repo cannot assume it owns one
# fixed bucket name). Convention: `${project_id}-tfstate-${environment}`, i.e.
# `project-39965ce5-4c4b-495e-8d4-tfstate-prod`, created out-of-band before first init.
#
# For offline validation, `tofu init -backend=false` skips it entirely.
terraform {
  backend "gcs" {
    # Distinct prefix from dev's "gke/dev" so the two environments' state never collide even
    # if they ever shared a bucket.
    prefix = "cloud-run/prod"
  }
}
