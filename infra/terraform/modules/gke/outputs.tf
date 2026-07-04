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
  # Always-on (not count-gated) — stable across suspend/resume. See the resource comment in main.tf.
  #
  # Construct the email from known inputs rather than reading google_service_account.gke_nodes.email.
  # The .email attribute is unknown-at-plan-time until the SA is created (or while it's pending the
  # moved rename), which propagates into module.iam's count = var.gke_node_sa_email != "" ? 1 : 0 and
  # breaks the plan with "Invalid count argument". The email is fully deterministic — account_id +
  # project_id — so build it as a static string to keep every downstream count/for_each plan-time-known.
  value = "${var.name_prefix}-gke-node-sa@${var.project_id}.iam.gserviceaccount.com"
}

