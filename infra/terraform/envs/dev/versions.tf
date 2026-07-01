terraform {
  required_version = ">= 1.6"

  required_providers {
    google = {
      source = "hashicorp/google"
      # Major 7 is the current provider line. The lock file pins the exact release;
      # update it deliberately with `tofu init -upgrade`, review the provider upgrade
      # guide, then commit the resulting lock-file change. `~> 7.0` accepts current
      # 7.x fixes but prevents an unreviewed future major upgrade.
      version = "~> 7.0"
    }
    # google-beta is used for the single beta-only resource google_project_service_identity
    # (auto-suspend.tf), which force-creates the Cloud Monitoring notification service agent.
    # Kept on the same major line as google so both upgrade together.
    google-beta = {
      source  = "hashicorp/google-beta"
      version = "~> 7.0"
    }
    random = {
      source  = "hashicorp/random"
      version = "~> 3.6"
    }
    # time_sleep bridges the eventual-consistency gap between creating the monitoring
    # notification service agent and granting it IAM (auto-suspend.tf).
    time = {
      source  = "hashicorp/time"
      version = "~> 0.12"
    }
  }
}
