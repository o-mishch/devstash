terraform {
  # >= 1.10: the iam module uses the write-only secret attribute `secret_data_wo` /
  # `secret_data_wo_version` (modules/iam/main.tf). This requires OpenTofu >= 1.10 OR
  # Terraform >= 1.11 — write-only arguments landed a minor later in Terraform. A single
  # required_version string cannot express that per-tool split, so this floor is calibrated for
  # OpenTofu (our pinned tool: the auto-suspend Cloud Build uses OpenTofu 1.12.3). Terraform
  # users must be on >= 1.11; Terraform 1.10.x passes this `>= 1.10` gate but then fails at
  # plan with a confusing "Unsupported argument: secret_data_wo". Prefer OpenTofu here.
  required_version = ">= 1.10"

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
