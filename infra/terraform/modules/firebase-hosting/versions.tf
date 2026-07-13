# google_firebase_hosting_custom_domain (main.tf) exists only in google-beta as of the current
# provider line — this module needs its own required_providers entry so callers must pass an
# explicit google-beta provider alias/config, same convention as the root envs/*/versions.tf.
terraform {
  required_providers {
    # google-beta only — every resource here is a google_firebase_* (beta-only). The deployer SA
    # + its IAM moved to the shared cloudbuild-deployer-sa module (envs/prod/deployers.tf).
    google-beta = {
      source  = "hashicorp/google-beta"
      version = "~> 7.0"
    }
  }
}
