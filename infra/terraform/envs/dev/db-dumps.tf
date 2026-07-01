# Cloud SQL logical-dump bucket — the durability mechanism for the deep suspend.
#
# On `run.sh suspend` the DB is exported here (`gcloud sql export sql`) and VERIFIED
# before the Cloud SQL instance is destroyed (db_active=false); on `run.sh resume` the
# recreated instance is restored from the latest dump (`gcloud sql import sql`). Because
# the instance no longer keeps a disk while suspended, THIS bucket is where the data
# lives — it must never be gated by the suspend toggle.
#
# Cost: in us-central1 (a GCS Always-Free region — 5 GB-month aggregate), a single small
# logical dump of a showcase DB is effectively $0. Server-side export/import runs as the
# Cloud SQL service agent, so it works over the instance's private-only networking (no
# public IP, no laptop connectivity needed).
#
# data.google_project.current is declared in budget.tf (shared across the env).

resource "google_storage_bucket" "db_dumps" {
  # Globally-unique name, same prefixing scheme as the uploads bucket.
  name     = "${var.project_id}-${local.name_prefix}-db-dumps"
  location = var.region # keep in the Always-Free region for ~$0 storage

  uniform_bucket_level_access = true
  public_access_prevention    = "enforced"

  # Versioning ON. Every suspend overwrites a single well-known object
  # (devstash-latest.sql); with versioning, the prior dump becomes a NONCURRENT version
  # instead of being discarded. This gives a few generations of rollback AND — critically —
  # means the retention rules below only ever target noncurrent versions, so the LIVE dump
  # (what resume needs) is never deleted no matter how long the env stays suspended.
  versioning {
    enabled = true
  }

  # Retention applies to NONCURRENT (archived) versions ONLY — `with_state = "ARCHIVED"`
  # excludes the live object, so a long-suspended env can NEVER lose its current dump.
  # Keep the N most recent superseded dumps for rollback (var.db_dump_keep_versions)...
  lifecycle_rule {
    condition {
      num_newer_versions = var.db_dump_keep_versions
      with_state         = "ARCHIVED"
    }
    action {
      type = "Delete"
    }
  }
  # ...and also expire superseded dumps older than var.db_dump_keep_days to bound cost.
  # Neither rule can touch the live version. (WARNING: do NOT add an unqualified
  # `age`/`with_state = "ANY"` Delete rule here — that would delete the current dump on a
  # long suspend and lose the DB.)
  lifecycle_rule {
    condition {
      days_since_noncurrent_time = var.db_dump_keep_days
      with_state                 = "ARCHIVED"
    }
    action {
      type = "Delete"
    }
  }

  labels = local.common_labels

  depends_on = [google_project_service.apis]
}

# Cloud SQL export/import runs as the instance's OWN service account
# (its serviceAccountEmailAddress: p<project_number>-<hash>@gcp-sa-cloud-sql...), NOT the
# operator or the app SA. It needs create (export) + read (import) on the dump bucket;
# objectAdmin is the narrow predefined role covering both on THIS bucket only (no access to
# the uploads bucket). CRITICAL: this is a PER-INSTANCE identity whose hash is regenerated
# every time the instance is recreated (each resume), so the member MUST be read from the
# live instance (module.cloudsql.service_account_email), never a hardcoded project-agent
# email — a hardcoded `service-<num>@gcp-sa-cloud-sql` does not exist and the grant fails
# with "Service account … does not exist". Gated on db_active: when the instance is
# deep-suspended there is no SA to grant (nothing to export); the grant is recreated with
# the fresh SA on resume. The export in run.sh suspend runs while db_active is still true,
# so the binding is present exactly when a dump is taken.
resource "google_storage_bucket_iam_member" "sql_agent_db_dumps" {
  count  = var.db_active ? 1 : 0
  bucket = google_storage_bucket.db_dumps.name
  role   = "roles/storage.objectAdmin"
  member = "serviceAccount:${module.cloudsql.service_account_email}"
}
