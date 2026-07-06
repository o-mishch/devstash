output "app_service_account_email" {
  value = google_service_account.app.email
}

output "deployer_service_account_email" {
  value = google_service_account.deployer.email
}

# The on-demand suspend/resume identity — this is the value for the GitHub secret
# LIFECYCLE_DEPLOYER_SA consumed by google-github-actions/auth in infra-lifecycle.yml.
output "lifecycle_deployer_service_account_email" {
  value = google_service_account.lifecycle_deployer.email
}

# Full provider resource name — this is the value for the GitHub secret
# WORKLOAD_IDENTITY_PROVIDER consumed by google-github-actions/auth.
# Format: projects/<num>/locations/global/workloadIdentityPools/github-actions/providers/github
output "wif_provider" {
  value = google_iam_workload_identity_pool_provider.github.name
}

# GCS S3-interop access id (non-sensitive). The matching secret lives in the
# consolidated devstash-app-config secret under the `s3-secret` property; both are
# surfaced to the app by External Secrets. Handy for debugging which HMAC key the bucket sees.
output "s3_interop_access_id" {
  value = google_storage_hmac_key.uploads.access_id
}
