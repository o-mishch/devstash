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
    random = {
      source  = "hashicorp/random"
      version = "~> 3.6"
    }
  }
}
