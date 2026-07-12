# google_firebase_hosting_custom_domain (main.tf) exists only in google-beta as of the current
# provider line — this module needs its own required_providers entry so callers must pass an
# explicit google-beta provider alias/config, same convention as the root envs/*/versions.tf.
terraform {
  required_providers {
    # google-beta for google_firebase_* resources; google for the deployer SA + IAM bindings.
    google = {
      source  = "hashicorp/google"
      version = "~> 7.0"
    }
    google-beta = {
      source  = "hashicorp/google-beta"
      version = "~> 7.0"
    }
  }
}
