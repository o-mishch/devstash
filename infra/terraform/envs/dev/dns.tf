# Spaceship DNS API credentials → Secret Manager.
#
# These are OPS credentials used by `infra/gcp-run/run.sh resume` to re-point the
# gke.* A-record at the freshly-allocated ingress IP after a suspend (the global IP is
# released on suspend and reallocated on resume). They are deliberately kept OUT of the
# app's third_party_secrets / ExternalSecret — the application never needs them — and
# stored as standalone Secret Manager secrets that run.sh reads with
# `gcloud secrets versions access`.
#
# Sourced from the gitignored terraform.tfvars like every other real credential. Gated on
# a non-empty value so an empty default simply skips creation (DNS can still be updated
# via the SPACESHIP_API_KEY / SPACESHIP_API_SECRET env vars, or by hand). Values land in
# tfstate — protected by the same CMEK-encrypted GCS backend as all other secrets here
# (see the SENSITIVE MAP SEMANTICS note in variables.tf). To rotate without a full apply,
# use `run.sh set-dns-creds` (adds a new Secret Manager version directly).

resource "google_secret_manager_secret" "spaceship_api_key" {
  count     = var.spaceship_api_key != "" ? 1 : 0
  secret_id = "devstash-spaceship-api-key"

  replication {
    auto {}
  }

  labels = local.common_labels
}

resource "google_secret_manager_secret_version" "spaceship_api_key" {
  count       = var.spaceship_api_key != "" ? 1 : 0
  secret      = google_secret_manager_secret.spaceship_api_key[0].id
  secret_data = var.spaceship_api_key
}

resource "google_secret_manager_secret" "spaceship_api_secret" {
  count     = var.spaceship_api_secret != "" ? 1 : 0
  secret_id = "devstash-spaceship-api-secret"

  replication {
    auto {}
  }

  labels = local.common_labels
}

resource "google_secret_manager_secret_version" "spaceship_api_secret" {
  count       = var.spaceship_api_secret != "" ? 1 : 0
  secret      = google_secret_manager_secret.spaceship_api_secret[0].id
  secret_data = var.spaceship_api_secret
}
