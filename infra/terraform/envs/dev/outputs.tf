output "gke_cluster_name" {
  value = module.gke.cluster_name
}

output "artifact_registry_url" {
  value = module.artifact_registry.repository_url
}

# Managed Cloud SQL. The app uses the PRIVATE IP in-VPC (synced to Secret Manager).
# For DIRECT developer access via the PUBLIC IP (must be in db_authorized_networks):
#   tofu output -raw db_public_database_url
output "db_public_ip" {
  value = module.cloudsql.public_ip
}

output "db_public_database_url" {
  value     = module.cloudsql.public_database_url
  sensitive = true
}

# Memorystore is PRIVATE (no public IP) — reach it from inside the VPC only. Host
# for redis-cli / RedisInsight (run them in-cluster or via a bastion). AUTH + CA are
# in the synced Secret; see "Підключення до Memorystore" in 08-gcp-bootstrap.md.
output "redis_host" {
  value = module.memorystore.host
}

output "uploads_bucket" {
  value = module.gcs.bucket_name
}

output "app_service_account_email" {
  value = module.iam.app_service_account_email
}

output "deployer_service_account_email" {
  value = module.iam.deployer_service_account_email
}

# --- GitHub Actions secrets (Category 4) ----------------------------------
# After `tofu apply`, copy these into the repo's secrets:
#   gh secret set GCP_PROJECT_ID --body "$(tofu output -raw gcp_project_id)"
#   gh secret set DEPLOYER_SA --body "$(tofu output -raw deployer_service_account_email)"
#   gh secret set WORKLOAD_IDENTITY_PROVIDER --body "$(tofu output -raw wif_provider)"
output "gcp_project_id" {
  value = var.project_id
}

output "wif_provider" {
  value = module.iam.wif_provider
}

# --- Ingress / DNS --------------------------------------------------------
# Point an A-record for var.app_domain at this IP; the managed cert provisions
# once DNS resolves here.
output "ingress_ip_address" {
  value = module.network.ingress_ip_address
}

output "app_domain" {
  value = var.app_domain
}

output "email_from" {
  value = var.email_from
}

# Cloud Armor security policy name — wire into the BackendConfig annotation or
# pass to `yq` in CI to set settings.yaml .data.armorPolicyName.
output "armor_policy_name" {
  value = module.network.armor_policy_name
}

# Handy for `kubectl` config after apply. --dns-endpoint is required: the cluster
# has enable_private_endpoint = true (no public IP), so the classic API-server
# endpoint is disabled. The DNS-based endpoint authenticates via IAM (the same SA
# used by CI) and is the only way to reach the control plane from outside the VPC.
output "get_credentials_command" {
  value = "gcloud container clusters get-credentials ${module.gke.cluster_name} --region ${var.region} --project ${var.project_id} --dns-endpoint"
}
