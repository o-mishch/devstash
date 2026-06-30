output "cluster_name" {
  value = google_container_cluster.primary.name
}

output "cluster_endpoint" {
  value     = google_container_cluster.primary.endpoint
  sensitive = true
}

output "cluster_ca_certificate" {
  value     = google_container_cluster.primary.master_auth[0].cluster_ca_certificate
  sensitive = true
}

output "workload_identity_pool" {
  value = "${var.project_id}.svc.id.goog"
}

# --- Binary Authorization attestor wiring -----------------------------------
# Consumed by modules/iam (signer + note-attacher IAM grants for the deployer SA)
# and surfaced at the root as repo variables CI's "Sign images" step reads.
output "binauthz_attestor_name" {
  value = google_binary_authorization_attestor.devstash_slsa.name
}

output "binauthz_note_id" {
  value = google_container_analysis_note.devstash_slsa.id
}

output "binauthz_kms_crypto_key_id" {
  value = google_kms_crypto_key.binauthz_signer.id
}

output "binauthz_kms_keyring" {
  value = google_kms_key_ring.binauthz.name
}

output "binauthz_kms_key" {
  value = google_kms_crypto_key.binauthz_signer.name
}
