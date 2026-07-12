# Artifact Registry — Docker repository the CI pipeline pushes images to and GKE
# pulls from. Replaces "where does the image live" (Docker Hub / ECR equivalent).

resource "google_artifact_registry_repository" "docker" {
  count = var.create ? 1 : 0

  repository_id = var.repository_id
  location      = var.region
  format        = "DOCKER"
  description   = "DevStash container images"

  # deletion_policy defaults to DELETE — a `terraform destroy` (i.e. the -refresh=false suspend
  # apply when var.create flips to false) force-deletes the repo AND every image/version/tag it
  # holds, the equivalent of `gcloud artifacts repositories delete`. No pre-empty step needed.

  # GCP requires a DELETE policy AND a KEEP policy: KEEP marks what to preserve,
  # DELETE removes everything else. A KEEP-only policy never deletes anything.
  #
  # $0-IDLE GOAL (dev). The dominant Artifact Registry cost was NEVER the images — it was the
  # buildx mode=max cache. type=registry,mode=max pushed a ~900 MB :buildcache blob per
  # image; being tagged it dodged every untagged policy, and being rewritten each build it
  # never aged out. ~1.8 GB no cleanup policy could evict. That cache now lives in the
  # GitHub Actions cache (type=gha, see infra/ci/docker-bake.hcl), off GAR entirely, so the
  # policies below only govern the runtime images, whose deduped compressed storage fits
  # the 0.5 GB free tier → $0.
  #
  # Two KEEP guards prevent running pods/services from losing their image during a deploy storm:
  #   1. keep-recent: retain only var.keep_count newest push(es) per package. Dev trades away
  #      rollback depth (default 1 — ephemeral, suspend/resume rebuilds from CI): "roll back"
  #      == re-run the pipeline, not pull a stale digest. Prod raises keep_count so a Cloud Run
  #      rollback can reach back further than "the last push".
  #   2. keep-young: always retain TAGGED images pushed within var.keep_young_seconds regardless
  #      of count — a rapid-push burst can't evict an image a consumer is currently pulling.
  #      Scoped to tag_state = "TAGGED" so it does NOT shield untagged garbage (superseded
  #      :latest targets, orphaned manifests): those fall straight to delete-old on the next
  #      cleanup run.
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
      keep_count = var.keep_count
    }
  }
  cleanup_policies {
    id     = "keep-young"
    action = "KEEP"
    condition {
      tag_state  = "TAGGED"
      newer_than = "${var.keep_young_seconds}s"
    }
  }

  labels = var.labels
}
