# Cluster attributes are null when the environment is suspended (cluster_active =
# false → the cluster is destroyed). Callers that interpolate these must guard for null.
output "cluster_name" {
  value = try(google_container_cluster.primary[0].name, null)
}

output "cluster_endpoint" {
  value     = try(google_container_cluster.primary[0].endpoint, null)
  sensitive = true
}

output "cluster_ca_certificate" {
  value     = try(google_container_cluster.primary[0].master_auth[0].cluster_ca_certificate, null)
  sensitive = true
}

output "workload_identity_pool" {
  value = "${var.project_id}.svc.id.goog"
}

# --- Binary Authorization attestor wiring -----------------------------------
# Consumed by modules/iam (signer + note-attacher IAM grants for the deployer SA)
# and surfaced at the root as repo variables CI's "Sign images" step reads.
# All null when var.binauthz_enabled = false (the pipeline is not provisioned) — one()
# collapses the count-indexed resource to a single value or null. Root consumers
# (run.sh gh-variable set, the CI signing step) must skip when these are null/empty.
output "binauthz_attestor_name" {
  value = one(google_binary_authorization_attestor.devstash_slsa[*].name)
}

output "binauthz_note_id" {
  value = one(google_container_analysis_note.devstash_slsa[*].id)
}

output "binauthz_kms_crypto_key_id" {
  value = one(google_kms_crypto_key.binauthz_signer[*].id)
}

output "binauthz_kms_keyring" {
  value = one(google_kms_key_ring.binauthz[*].name)
}

output "binauthz_kms_key" {
  value = one(google_kms_crypto_key.binauthz_signer[*].name)
}

output "node_service_account_email" {
  value = try(google_service_account.gke_nodes[0].email, "")
}

