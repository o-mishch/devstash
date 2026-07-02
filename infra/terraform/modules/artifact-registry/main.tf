# Artifact Registry — Docker repository the CI pipeline pushes images to and GKE
# pulls from. Replaces "where does the image live" (Docker Hub / ECR equivalent).

resource "google_artifact_registry_repository" "docker" {
  repository_id = "devstash"
  location      = var.region
  format        = "DOCKER"
  description   = "DevStash container images"

  # GCP requires a DELETE policy AND a KEEP policy: KEEP marks what to preserve,
  # DELETE removes everything else. A KEEP-only policy never deletes anything.
  #
  # Two KEEP guards prevent running pods from losing their image during a deploy storm:
  #   1. keep-recent: retain only the 1 newest push per package. Image storage is the
  #      single cost that SURVIVES a deep suspend and was the last non-$0 idle line item
  #      (measured 4.3 GB / ~$0.38/mo during a deploy-churn burst). Lowered 10 → 3 → 1 to
  #      pull the deduped idle floor (1×web + 1×migrate) UNDER the 0.5 GB Artifact Registry
  #      free tier → true $0 idle. Rollback depth is intentionally traded away: this env is
  #      ephemeral (suspend/resume rebuilds from CI), so "roll back" == re-run the pipeline,
  #      not pull a stale digest. keep-young below still protects any image a pod could be
  #      mid-pull. Raise for prod, where rollback-to-previous-digest matters.
  #   2. keep-young:  always retain images pushed within the last 2 days regardless of
  #      count — a rapid-push burst can't evict an image a pod is currently pulling. Shortened
  #      7 d → 2 d so a churn burst (like the 30+ versions measured above) ages out of the
  #      retention window within ~2 days and the next cleanup run prunes it to keep-recent,
  #      instead of squatting 4+ GB for a full week. 2 d comfortably covers an active
  #      demo/deploy cycle (the hard uptime cap is 90 min).
  #
  # ── condition is MANDATORY on a DELETE policy — DO NOT remove ─────────────────
  # The Artifact Registry API rejects any DELETE policy that has neither a
  # `condition` nor a `most_recent_versions` block: "invalid cleanup policy:
  # policy is missing a condition" (HTTP 400). `tofu validate` does NOT catch this
  # (the condition is schema-optional); it only fails at real `tofu apply`. The
  # broadest legal condition is tag_state = "ANY" (matches tagged + untagged), which
  # gives the intended "delete everything the KEEP policies don't retain": when an
  # artifact matches both a DELETE and a KEEP policy, Artifact Registry keeps it.
  # Sources: cloud.google.com/artifact-registry/docs/repositories/cleanup-policy
  # ("A delete policy must include a name, an action, and at least one condition")
  # and hashicorp/terraform-provider-google issue #23486.
  # ─────────────────────────────────────────────────────────────────────────────
  cleanup_policies {
    id     = "delete-old"
    action = "DELETE"
    condition {
      tag_state = "ANY"
    }
  }
  cleanup_policies {
    id     = "keep-recent"
    action = "KEEP"
    most_recent_versions {
      keep_count = 1
    }
  }
  cleanup_policies {
    id     = "keep-young"
    action = "KEEP"
    condition {
      newer_than = "172800s" # 2 days
    }
  }

  labels = var.labels
}
