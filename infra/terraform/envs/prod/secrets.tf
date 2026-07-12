# ONE consolidated secret holding a JSON object of every sensitive backend var, so the whole
# prod service needs a SINGLE active Secret Manager version. Cloud Run mounts it as APP_CONFIG
# and backend/internal/config splits it back into individual env vars at boot — Cloud Run has no
# External Secrets Operator to do that splitting like dev's GKE does. One active version keeps the
# billing account inside Secret Manager's 6-free-version tier ($0). This SUPERSEDES the individual
# devstash-database-url / devstash-auth-* secrets, which are deleted after cutover (see README).
#
# Written with secret_data_wo (write-only): the value is NEVER stored in Terraform state; it comes
# from var.app_config in the gitignored terraform.tfvars. Mirrors dev's modules/iam app_config.
resource "google_secret_manager_secret" "app_config" {
  secret_id = "devstash-prod-config"

  replication {
    user_managed {
      replicas {
        location = var.region
      }
    }
  }

  labels = local.common_labels
}

resource "google_secret_manager_secret_version" "app_config" {
  secret         = google_secret_manager_secret.app_config.id
  secret_data_wo = jsonencode(var.app_config)
  # Content-derived version: secret_data_wo isn't read back, so Terraform re-pushes only when this
  # integer changes — deriving it from the blob's sha256 auto-bumps on any value change. 7 hex
  # digits keeps it a positive int32. Same pattern as dev's app_config_wo_version.
  secret_data_wo_version = parseint(substr(sha256(jsonencode(var.app_config)), 0, 7), 16)
  deletion_policy        = "DISABLE"
}

# The Cloud Run service (running as the compute default SA) reads the secret. Scoped to THIS
# secret only — least privilege.
resource "google_secret_manager_secret_iam_member" "app_config_access" {
  secret_id = google_secret_manager_secret.app_config.id
  role      = "roles/secretmanager.secretAccessor"
  member    = "serviceAccount:${local.compute_default_sa_email}"
}
