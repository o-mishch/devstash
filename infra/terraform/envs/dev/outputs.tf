output "gke_cluster_name" {
  value = module.gke.cluster_name
}

output "artifact_registry_url" {
  value = module.artifact_registry.repository_url
}

# The STATIC repository id ("devstash") — resolves even while the repo resource is gated off
# (deep-suspend), same as repository_url. The devstash-infra CLI reads this as the single source of truth for
# the AR-writable dispatch gate (_wait_ar_push_ready) instead of re-hardcoding the repo name
# that CI already carries as deploy-gke.yml's REPO.
output "artifact_registry_repository_id" {
  value = module.artifact_registry.repository_id
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

# Memorystore for Valkey is PRIVATE (PSC endpoint, no public IP) — reach it from inside
# the VPC only. Host for valkey-cli / RedisInsight (run them in-cluster or via a bastion).
# There is no static password: auth is IAM (an OAuth2 access token minted for the caller);
# the CA is in the synced Secret. See "Підключення до Memorystore" in 08-gcp-bootstrap.md.
output "redis_host" {
  # Null when suspended (Memorystore destroyed). module.memorystore is count-indexed.
  value = one(module.memorystore[*].host)
}

output "uploads_bucket" {
  value = module.gcs.bucket_name
}

# Cloud SQL instance name + dump bucket — consumed by devstash-infra gcp suspend/resume for the
# `gcloud sql export|import` round trip. The name is computed (not read from the resource)
# so it is available even while deep-suspended (the instance is gone); the devstash-infra CLI needs it to
# name the export target and the import destination.
output "db_instance_name" {
  value = local.db_instance_name
}

output "db_dumps_bucket" {
  value = google_storage_bucket.db_dumps.name
}

# Well-known object name of the Cloud SQL logical dump. The devstash-infra CLI reads this so its
# suspend/resume round trip uses the exact object the auto-suspend path writes.
output "db_dump_object" {
  value = local.db_dump_object
}

# Noncurrent-dump retention count, surfaced so devstash-infra's dump_db can SYNCHRONOUSLY prune the
# dump history to the same size the async lifecycle rule (db-dumps.tf) targets — one variable,
# two enforcement mechanisms, guaranteed not to drift. The sync prune keeps this + 1 total
# generations (the live dump plus this many noncurrent), matching the lifecycle rule which
# counts noncurrent-only.
output "db_dump_keep_versions" {
  value = var.db_dump_keep_versions
}

output "app_service_account_email" {
  value = module.iam.app_service_account_email
}

output "deployer_service_account_email" {
  value = module.iam.deployer_service_account_email
}

# The on-demand suspend/resume identity for infra-lifecycle.yml. Copy into the repo secret
# LIFECYCLE_DEPLOYER_SA (see the Category 4 note below).
output "lifecycle_deployer_service_account_email" {
  value = module.iam.lifecycle_deployer_service_account_email
}

# --- GitHub Actions secrets (Category 4) ----------------------------------
# After `tofu apply`, copy these into the repo's secrets:
#   gh secret set GCP_PROJECT_ID --body "$(tofu output -raw gcp_project_id)"
#   gh secret set DEPLOYER_SA --body "$(tofu output -raw deployer_service_account_email)"
#   gh secret set LIFECYCLE_DEPLOYER_SA --body "$(tofu output -raw lifecycle_deployer_service_account_email)"
#   gh secret set WORKLOAD_IDENTITY_PROVIDER --body "$(tofu output -raw wif_provider)"
#
# And these repo VARIABLES (non-secret — attestor/KMS resource names, not credentials)
# consumed by the "Sign images for Binary Authorization" step. Present ONLY when
# binauthz_enabled = true; when false these outputs are null (`tofu output -raw` errors on
# null) and the CI signing step self-skips. `devstash-infra gcp secrets` handles both cases —
# prefer it over setting these by hand:
#   gh variable set BINAUTHZ_ATTESTOR --body "$(tofu output -raw binauthz_attestor_name)"
#   gh variable set BINAUTHZ_KMS_KEYRING --body "$(tofu output -raw binauthz_kms_keyring)"
#   gh variable set BINAUTHZ_KMS_KEY --body "$(tofu output -raw binauthz_kms_key)"
output "gcp_project_id" {
  value = var.project_id
}

output "wif_provider" {
  value = module.iam.wif_provider
}

output "binauthz_attestor_name" {
  value = module.gke.binauthz_attestor_name
}

output "binauthz_kms_keyring" {
  value = module.gke.binauthz_kms_keyring
}

output "binauthz_kms_key" {
  value = module.gke.binauthz_kms_key
}

# --- Gateway / TLS (Certificate Manager) ----------------------------------
# The Gateway references the cert MAP by name via the networking.gke.io/certmap annotation
# (overlays/gcp). CI injects this into settings.yaml (data.certMapName) so the committed
# manifest stays a placeholder. Survives suspend (Certificate Manager is project-scoped).
output "cert_map_name" {
  value = google_certificate_manager_certificate_map.app.name
}

# The underlying certificate resource (distinct from the map above) — devstash-infra gcp `status` queries
# this directly rather than deriving it from cert_map_name by string substitution.
output "cert_name" {
  value = google_certificate_manager_certificate.app.name
}

# One-time DNS-authorization CNAME for the Google-managed cert. Because the domain is on
# Spaceship (not Cloud DNS), the operator adds this CNAME ONCE to the Spaceship zone; the cert
# then provisions and auto-renews forever, independent of suspend/resume. See §7 of
# infra/docs/08-gcp-bootstrap.md.
#   Add:  <dns_authorization_cname_record>  CNAME  <dns_authorization_cname_target>
output "dns_authorization_cname_record" {
  value = google_certificate_manager_dns_authorization.app.dns_resource_record[0].name
}
output "dns_authorization_cname_target" {
  value = google_certificate_manager_dns_authorization.app.dns_resource_record[0].data
}

# --- Ingress / DNS --------------------------------------------------------
# Point an A-record for var.app_domain at this IP; the Gateway serves TLS from the
# Certificate Manager cert (already provisioned via the DNS-auth CNAME above).
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

# Whether Cloud Armor is provisioned — read by devstash-infra gcp secrets to set/clear the
# ARMOR_ENABLED CI variable that inject-settings.sh keys the BackendConfig policy on.
# Sourced from the var (not armor_policy_name, which is also null while suspended) so it is
# correct regardless of environment_active.
output "armor_enabled" {
  value = var.armor_enabled
}

# Handy for `kubectl` config after apply. --dns-endpoint is required: the cluster
# has enable_private_endpoint = true (no public IP), so the classic API-server
# endpoint is disabled. The DNS-based endpoint authenticates via IAM (the same SA
# used by CI) and is the only way to reach the control plane from outside the VPC.
output "get_credentials_command" {
  # Null cluster_name when suspended — interpolating it would error, so guard it.
  value = module.gke.cluster_name == null ? "environment suspended — run `devstash-infra gcp resume` first" : "gcloud container clusters get-credentials ${module.gke.cluster_name} --region ${var.region} --project ${var.project_id} --dns-endpoint"
}
