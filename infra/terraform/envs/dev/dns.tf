# Ops-only credentials → ONE consolidated Secret Manager secret (devstash-ops-config).
#
# Today this holds the Spaceship DNS API key/secret pair used by `infra/run/gcp/run.sh resume`
# to re-point the gke.* A-record at the freshly-allocated ingress IP after a suspend (the global
# IP is released on suspend and reallocated on resume). They are OPS creds — the application
# never needs them — so they are deliberately kept OUT of the app blob (devstash-app-config) and
# its app-SA secretAccessor grant. Consolidating the two former standalone secrets
# (devstash-spaceship-api-key / -secret) into a single JSON blob mirrors the app-config design:
# fewer secrets to inventory, and the whole ops surface is one grant. Consumers read individual
# values with `gcloud secrets versions access latest ... | jq -r .<key>` (run.sh, the
# auto-suspend prepare step, build-secrets-tfvars.py).
#
# Same hardening as app-config (see modules/iam/main.tf for the full rationale):
#   - secret_data_wo (write-only) — values never land in tfstate.
#   - secret_data_wo_version = a content-derived hash — auto-bumps on change, no manual tracking.
#   - deletion_policy = "DISABLE" — a removed version is disabled, never destroyed.
#
# The secret CONTAINER is always created (it holds no data) so it stays in state under every
# apply context; only the VERSION is gated on the creds. This split matters: the unattended
# resume apply (Cloud Build) can run WITHOUT the Spaceship creds, so a container gated on them
# would compute count=0, drop from state, and 409 on the next local apply — keeping the
# container ungated ends that orphan→409 cycle. If BOTH creds are empty only the version is
# skipped (DNS can still be driven via the SPACESHIP_API_KEY / SPACESHIP_API_SECRET env vars,
# or by hand). To rotate without a full apply, use `run.sh set-dns-creds` (writes a new version
# directly).

locals {
  ops_config_enabled = var.spaceship_api_key != "" && var.spaceship_api_secret != ""

  ops_secrets = {
    spaceship-api-key    = var.spaceship_api_key
    spaceship-api-secret = var.spaceship_api_secret
  }
  ops_config_json = jsonencode(local.ops_secrets)

  # 7 hex digits of sha256 → positive int32 (see the app-config version rationale).
  ops_config_wo_version = parseint(substr(sha256(local.ops_config_json), 0, 7), 16)
}

resource "google_secret_manager_secret" "ops_config" {
  secret_id = "devstash-ops-config"

  replication {
    auto {}
  }

  labels = local.common_labels

  # Outlive a full `run.sh down` — same rationale as app_config (see modules/iam/main.tf):
  # ~$0 to keep, painful to re-enter the Spaceship DNS creds by hand. `down` excludes this
  # address from `tofu destroy`; prevent_destroy backstops any unfiltered destroy.
  lifecycle {
    prevent_destroy = true
  }
}

resource "google_secret_manager_secret_version" "ops_config" {
  count                  = local.ops_config_enabled ? 1 : 0
  secret                 = google_secret_manager_secret.ops_config.id
  secret_data_wo         = local.ops_config_json
  secret_data_wo_version = local.ops_config_wo_version
  deletion_policy        = "DISABLE"
}
