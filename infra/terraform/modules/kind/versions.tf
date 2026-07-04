terraform {
  required_version = ">= 1.6"

  required_providers {
    # A child module that references a non-hashicorp resource type (kind_cluster) MUST declare
    # its own source, or OpenTofu resolves the "kind" local name to hashicorp/kind and fails.
    # The provider CONFIGURATION stays in envs/local/providers.tf; this only pins the source +
    # version constraint (kept in sync with envs/local/versions.tf).
    kind = {
      source  = "tehcyx/kind"
      version = "~> 0.11"
    }
  }
}
