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
  #   1. keep-recent: always retain the 3 newest pushes (rollback window). Lowered from
  #      10 → 3 for the $0-idle dev showcase: image storage is the single largest cost
  #      that SURVIVES a deep suspend (~$0.3–0.5/mo for 10 versions of web+migrate), so a
  #      shallower rollback depth is the biggest real idle saving. keep-young below still
  #      retains anything a running pod could be pulling, so this only trims STALE rollback
  #      targets (older than 7 days) — never an in-use image. Raise for prod.
  #   2. keep-young:  always retain images pushed within the last 7 days regardless of
  #      count — a rapid-push burst can't evict an image a pod is currently pulling.
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
      keep_count = 3
    }
  }
  cleanup_policies {
    id     = "keep-young"
    action = "KEEP"
    condition {
      newer_than = "604800s" # 7 days
    }
  }

  labels = var.labels
}
