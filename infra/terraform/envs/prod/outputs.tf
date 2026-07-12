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

# Once web/ exists (Frontend Track F0) and its GitHub Actions workflow is authored, add these
# DNS records to Spaceship for beta.devstash.one, then flip modules/firebase-hosting's
# wait_dns_verification to true in a follow-up apply.
output "firebase_required_dns_updates" {
  value = module.firebase_hosting.required_dns_updates
}

# --- GitHub Actions secrets ------------------------------------------------
# After `tofu apply`, copy these into the repo's secrets for the future Firebase Hosting
# deploy workflow (Frontend Track F0):
#   gh secret set GCP_PROJECT_ID --body "$(tofu output -raw gcp_project_id)"
#   gh secret set FIREBASE_DEPLOYER_SA --body "$(tofu output -raw firebase_deployer_service_account_email)"
#   gh secret set FIREBASE_WORKLOAD_IDENTITY_PROVIDER --body "$(tofu output -raw firebase_wif_provider)"
output "gcp_project_id" {
  value = var.project_id
}

output "firebase_deployer_service_account_email" {
  value = module.firebase_hosting.deployer_service_account_email
}

output "firebase_wif_provider" {
  value = module.firebase_hosting.wif_provider
}
