# Cloud Storage bucket — replaces AWS S3 for file/image uploads.
#
# Thin wrapper over the Cloud Foundation Toolkit `simple_bucket` module
# (terraform-google-modules/cloud-storage). The wrapper exists to (a) keep this
# module's stable interface — name_prefix/cors_origins in, bucket_name/bucket_url
# out — so callers (envs/dev) are unchanged, and (b) hold the two deliberate,
# non-default decisions that must never drift: the globally-unique name and the
# POST-only CORS.
#
# The app's storage code uses the AWS S3 SDK. GCS exposes an S3-interoperable
# (XML) API, so the app keeps the S3 SDK pointed at GCS's endpoint with HMAC keys —
# minimal app change. Both paths noted in infra/docs/03-terraform.md.

module "bucket" {
  source  = "terraform-google-modules/cloud-storage/google//modules/simple_bucket"
  version = "12.3.0"

  # Bucket names are globally unique across all GCP customers. Prefixing with this
  # project's globally unique ID makes bootstrap deterministic; `${name_prefix}-uploads`
  # alone can be owned by an unrelated project and fail at apply time.
  name       = "${var.project_id}-${var.name_prefix}-uploads"
  project_id = var.project_id
  location   = var.location

  # IAM-only, no per-object ACLs (best practice); block all public access.
  bucket_policy_only       = true
  public_access_prevention = "enforced"

  versioning = true

  # Lifecycle: clean up old object versions to control cost.
  lifecycle_rules = [{
    action    = { type = "Delete" }
    condition = { num_newer_versions = 3 }
  }]

  cors = [{
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
  }]

  labels = var.labels
}

# State migration: the bucket used to be a bare `google_storage_bucket.uploads` in
# this module; it now lives inside the `simple_bucket` child module. `moved` renames
# the state address in place — no destroy/recreate of the live bucket.
moved {
  from = google_storage_bucket.uploads
  to   = module.bucket.google_storage_bucket.bucket
}
