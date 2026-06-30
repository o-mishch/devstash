# Cloud Storage bucket — replaces AWS S3 for file/image uploads.
#
# The app's storage code uses the AWS S3 SDK. GCS exposes an S3-interoperable
# (XML) API, so the app can keep using the S3 SDK pointed at GCS's endpoint with
# HMAC keys — minimal app change. Alternatively, migrate to the GCS SDK. Both
# paths noted in infra/docs/03-terraform.md.

resource "google_storage_bucket" "uploads" {
  # Bucket names are globally unique across all GCP customers. Prefixing with this
  # project's globally unique ID makes bootstrap deterministic; `${name_prefix}-uploads`
  # alone can be owned by an unrelated project and fail at apply time.
  name     = "${var.project_id}-${var.name_prefix}-uploads"
  location = var.location

  uniform_bucket_level_access = true # IAM-only, no per-object ACLs (best practice)
  public_access_prevention    = "enforced"

  versioning {
    enabled = true
  }

  # Lifecycle: clean up old object versions to control cost.
  lifecycle_rule {
    condition {
      num_newer_versions = 3
    }
    action {
      type = "Delete"
    }
  }

  cors {
    origin = var.cors_origins
    # The browser performs exactly one cross-origin storage operation: XHR POST to
    # a presigned form (src/lib/storage-client/s3-upload-client.ts). Downloads use
    # normal anchor/image navigation, while GET/DELETE/HEAD SDK calls are server-side
    # and are not governed by browser CORS. Do not broaden this list to mirror IAM.
    method = ["POST"]
    # The upload client currently reads only HTTP status. Keep ETag/Content-Type
    # available for future upload verification without exposing every response header.
    response_header = ["Content-Type", "ETag"]
    max_age_seconds = 3600
  }

  labels = var.labels
}
