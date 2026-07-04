terraform {
  required_version = ">= 1.6"

  required_providers {
    # tehcyx/kind drives kind (Kubernetes IN Docker) — the local analog of hashicorp/google
    # in envs/dev. It is a third-party provider; the lock file (.terraform.lock.hcl) pins the
    # exact release. Update it deliberately with `tofu init -upgrade`, then commit the lock
    # change. `~> 0.11` accepts current 0.11.x fixes but prevents an unreviewed minor bump
    # (a 0.x line, so the minor is the compatibility boundary).
    kind = {
      source  = "tehcyx/kind"
      version = "~> 0.11"
    }
  }
}
