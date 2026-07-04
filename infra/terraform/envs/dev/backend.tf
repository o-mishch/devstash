# Remote state in a GCS bucket. State holds the mapping of config → real resources
# (and can contain secrets), so it must NOT live on a laptop or in git. GCS gives:
#   - durability + versioning (recover a bad apply)
#   - state locking (GCS supports it natively — two engineers can't apply at once)
#   - a shared source of truth for CI and humans
#
# Chicken-and-egg: this bucket must exist before `tofu init`. run.sh creates the
# globally unique `${project_id}-tfstate-${environment}` bucket out-of-band and passes
# it with `-backend-config`. Do not hard-code a generic bucket name here: GCS bucket
# names are global, and a reusable repository cannot assume it owns one fixed name.
#
# For offline validation, `tofu init -backend=false` skips it. Real apply/destroy
# must use run.sh or pass the explicit bucket with `-backend-config`.
terraform {
  backend "gcs" {
    # Partial backend config: bucket is supplied by infra/run/gcp/run.sh after it
    # reads project_id/environment from the gitignored terraform.tfvars.
    prefix = "gke/dev"
  }
}
