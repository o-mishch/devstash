output "cloud_run_service_uri" {
  value = module.cloud_run.service_uri
}

output "cloud_run_domain" {
  value = var.app_domain
}

output "artifact_registry_repository_url" {
  value = module.artifact_registry.repository_url
}

output "cloudbuild_trigger_id" {
  value = module.cloudbuild_trigger.trigger_id
}

output "firebase_hosting_site_id" {
  value = module.firebase_hosting.site_id
}

output "firebase_hosting_default_url" {
  value = module.firebase_hosting.default_url
}

output "firebase_custom_domain_status" {
  value = module.firebase_hosting.custom_domain_status
}

# Once web/ exists (Frontend Track F0) and DNS is pointed at Firebase, add these records to
# Spaceship for beta.devstash.one, then flip modules/firebase-hosting's wait_dns_verification
# to true in a follow-up apply.
output "firebase_required_dns_updates" {
  value = module.firebase_hosting.required_dns_updates
}

output "gcp_project_id" {
  value = var.project_id
}

# The identity the web/** Cloud Build trigger deploys as (Firebase Hosting only). Surfaced for
# auditing; no GitHub secret needed — Cloud Build authenticates it via the metadata server.
output "firebase_deployer_service_account_email" {
  value = module.firebase_deployer.email
}

# The identity the backend/** Cloud Build trigger deploys as (Cloud Run + Artifact Registry).
output "backend_deployer_service_account_email" {
  value = module.backend_deployer.email
}
