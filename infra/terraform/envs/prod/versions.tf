terraform {
  # >= 1.10: OpenTofu's write-only-attribute floor — required because secrets.tf writes the
  # consolidated app-config secret via `secret_data_wo` (kept off state). Same floor as dev.
  required_version = ">= 1.10"

  required_providers {
    google = {
      source  = "hashicorp/google"
      version = "~> 7.0"
    }
    # Required for google_firebase_hosting_custom_domain (modules/firebase-hosting), which is
    # google-beta-only as of the current provider line.
    google-beta = {
      source  = "hashicorp/google-beta"
      version = "~> 7.0"
    }
  }
}
