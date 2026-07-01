locals {
  name_prefix = "devstash-${var.environment}"

  # Well-known object name for the Cloud SQL logical dump in the db-dumps bucket.
  # Single source of truth: the auto-suspend Cloud Build path (_DB_DUMP_OBJECT) and
  # run.sh (via the db_dump_object output) both read this, so the object suspend WRITES
  # is always the object resume READS. Overwritten each suspend; prior dumps become
  # noncurrent versions (see db-dumps.tf).
  db_dump_object = "devstash-latest.sql"

  # Cloud SQL instance name. Single source of truth for the "-pg" suffix convention across
  # the root module: the db_instance_name output (run.sh suspend/resume) and the auto-suspend
  # Cloud Build sub (_DB_INSTANCE) both read this. It is computed (not read from the module
  # output, which is null while deep-suspended) so it is available even when the instance is
  # gone. The cloudsql module builds the same name from var.name_prefix — that copy is the
  # unavoidable acyclic module interface; these root consumers must not re-derive it by hand.
  db_instance_name = "${local.name_prefix}-pg"

  # Labels applied to every resource that supports them — essential for cost
  # attribution, ownership, and cleanup. "Untagged resources" is a real interview
  # red flag; tag everything.
  common_labels = {
    app         = "devstash"
    environment = var.environment
    managed_by  = "terraform"
  }
}
