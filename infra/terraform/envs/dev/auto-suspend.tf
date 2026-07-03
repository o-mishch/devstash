# Idle auto-suspend — event-driven, no scheduler.
#
# WHAT IT DOES — a Cloud Monitoring alert fires when the ingress load balancer has served
# zero requests for auto_suspend_idle_window_seconds (i.e. nobody is using the showcase).
# The alert publishes to a Pub/Sub topic, which triggers a Cloud Build that first DUMPS
# Cloud SQL to the GCS db-dumps bucket (verifying the dump is non-empty), then runs
# `tofu apply -var environment_active=false -var db_active=false` — driving the env to true
# ~$0 (cluster/Memorystore/NAT/Armor/ingress-IP AND the Cloud SQL instance destroyed; data
# preserved in the verified dump). This is exactly `run.sh suspend`, unattended.
#
# DATA SAFETY — the dump-and-verify runs as a SEPARATE build step BEFORE the destroy apply.
# `set -eu` + a non-empty size check make a failed/empty export exit non-zero, which fails
# the build so the apply never runs — an un-dumped instance is never destroyed.
#
# TWO TRIGGERS, ONE TOPIC. (1) A Monitoring alert on metric-absence fires the moment ingress
# traffic has been zero for the idle window — fast suspend when the env is genuinely idle.
# But a PUBLIC LB never sees true zero: internet background scanners keep request_count > 0,
# so on its own the alert can fail to fire indefinitely and the env bleeds ~$0.13/hr 24/7.
# (2) So a Cloud Scheduler cron publishes to the same topic on a fixed cadence regardless of
# traffic; the guard then applies a HARD UPTIME CAP (_MAX_UPTIME) and suspends unconditionally
# once the cluster is older than that — scanner-proof. Both paths hit the same idempotent
# guard, which re-checks live state, so overlapping fires are harmless no-ops.
#
# RESUME IS NEVER AUTOMATED — this only drives the env DOWN. Bring it back with
# `run.sh resume`.
#
# CANNOT SUSPEND A BUSY ENV — the build's first step re-checks the live request count and a
# fresh-resume grace (cluster younger than the idle window is left alone), then only
# proceeds if still idle. So a stray notification (e.g. the alert's "resolved" message when
# traffic returns) is a no-op, not a wrongful teardown.
#
# LEAST PRIVILEGE — the build runs as a dedicated `…-lifecycle` SA, separate from the
# deploy SA. The apply uses `-refresh=false`, so Terraform only calls the APIs for the
# resources these vars change (destroy compute + Cloud SQL instance / drop the redis-* +
# database-* secrets) plus the two read-only data sources — not the org-policy /
# service-usage / WIF / KMS-admin surface a full refresh would touch. The DB export runs as
# this same SA (cloudsql.admin covers export + delete); the actual GCS write is done by the
# Cloud SQL service agent, and the SA only gets read on the dump bucket for the verify.
#
# TF INPUTS — a headless apply needs every variable or it would destroy resources gated on
# the missing ones. Non-secret vars are baked into the trigger as a base64'd JSON tfvars
# blob (built from this same root module). App secrets + Spaceship creds are reconstructed
# at runtime from the `devstash-*` Secret Manager secrets a normal apply already created.
#
# All resources are gated on var.auto_suspend_enabled (ON by default; set false to opt out).

locals {
  auto_suspend_on = var.auto_suspend_enabled

  # State bucket created out-of-band by run.sh as ${project_id}-tfstate-${environment}
  # (see backend.tf). The build's `tofu init` targets it.
  tfstate_bucket = "${var.project_id}-tfstate-${var.environment}"

  # Exactly the roles the suspend build needs — nothing broader. Empty when disabled.
  #   container.admin        delete the GKE cluster (+ list/describe for the idle re-check)
  #   redis.admin            delete Memorystore
  #   compute.networkAdmin   delete ingress IP + Cloud Router + Cloud NAT
  #   compute.securityAdmin  delete the Cloud Armor policy
  #   cloudsql.admin         export the DB to GCS + DESTROY the instance (db_active=false)
  #   secretmanager.admin    delete the redis-* + database-* secrets; read all for reconstruction
  #   monitoring.viewer      read request_count for the idle re-check
  #   browser                data.google_project (resourcemanager.projects.get)
  #   cloudkms.viewer        data.google_kms_crypto_key_version (binauthz signer — ungated)
  #   logging.logWriter      Cloud Build custom-SA builds must write their own logs
  lifecycle_roles = local.auto_suspend_on ? [
    "roles/container.admin",
    "roles/redis.admin",
    "roles/compute.networkAdmin",
    "roles/compute.securityAdmin",
    "roles/cloudsql.admin",
    "roles/secretmanager.admin",
    "roles/monitoring.viewer",
    "roles/browser",
    "roles/cloudkms.viewer",
    "roles/logging.logWriter",
  ] : []

  # Non-secret tfvars for the headless apply — built from THIS module so the values match a
  # local apply exactly. environment_active is absent (forced to false on the command line);
  # secrets are reconstructed at runtime.
  auto_suspend_nonsecret_tfvars = base64encode(jsonencode({
    project_id                = var.project_id
    region                    = var.region
    environment               = var.environment
    github_repository         = var.github_repository
    github_owner_id           = var.github_owner_id
    app_domain                = var.app_domain
    email_from                = var.email_from
    billing_account           = var.billing_account
    monthly_budget_amount     = var.monthly_budget_amount
    db_tier                   = var.db_tier
    db_authorized_networks    = var.db_authorized_networks
    db_point_in_time_recovery = var.db_point_in_time_recovery
    db_highly_available       = var.db_highly_available
    memory_highly_available   = var.memory_highly_available
    armor_waf_preview         = var.armor_waf_preview
    deletion_protection       = var.deletion_protection
  }))

  # Secret KEYS are not sensitive (just names like "stripe-secret-key"); nonsensitive() lets
  # them flow into the non-sensitive substitutions map. Values are never placed here — the
  # build fetches them from Secret Manager. Sorted for a stable trigger diff.
  auto_suspend_secret_keys = nonsensitive(join(" ", sort(keys(var.third_party_secrets))))

  # Substitutions → step environment variables. The `script` field does NOT apply
  # substitutions to script CONTENT (and the provider doesn't expose automapSubstitutions),
  # so every $_VAR a script reads must be handed in as a real env var here — Cloud Build DOES
  # apply substitutions to `env` VALUES. Mapped identically onto all steps (unused vars in a
  # given step are harmless), so the scripts stay plain, lintable POSIX shell with no
  # Cloud-Build-specific `$$` escaping. "$_FOO" is a literal in HCL ($ not followed by {).
  auto_suspend_build_env = [
    "_PROJECT_ID=$_PROJECT_ID",
    "_REGION=$_REGION",
    "_STATE_BUCKET=$_STATE_BUCKET",
    "_REPO_SLUG=$_REPO_SLUG",
    "_REPO_BRANCH=$_REPO_BRANCH",
    "_SECRET_KEYS=$_SECRET_KEYS",
    "_NONSECRET_B64=$_NONSECRET_B64",
    "_IDLE_WINDOW=$_IDLE_WINDOW",
    "_MAX_UPTIME=$_MAX_UPTIME",
    "_DB_INSTANCE=$_DB_INSTANCE",
    "_DB_DUMPS_BUCKET=$_DB_DUMPS_BUCKET",
    "_DB_DUMP_OBJECT=$_DB_DUMP_OBJECT",
    "_AR_REPO=$_AR_REPO",
  ]

  # Pub/Sub + Cloud Build + Cloud Scheduler service agents (data.google_project is declared
  # in budget.tf). Needed so Cloud Build can run the build as the lifecycle SA and the
  # scheduler can publish the uptime-cap tick. (The monitoring-notification agent is
  # force-created via google_project_service_identity instead of hardcoded here, because it
  # is provisioned lazily and a hardcoded email races its creation on a fresh project.)
  cloudbuild_agent     = "service-${data.google_project.current.number}@gcp-sa-cloudbuild.iam.gserviceaccount.com"
  cloudscheduler_agent = "service-${data.google_project.current.number}@gcp-sa-cloudscheduler.iam.gserviceaccount.com"
}

# Pub/Sub + Cloud Build APIs — enabled only with the feature. (Monitoring API is enabled
# by the base stack.)
resource "google_project_service" "auto_suspend" {
  for_each = local.auto_suspend_on ? toset([
    "pubsub.googleapis.com",
    "cloudbuild.googleapis.com",
    "cloudscheduler.googleapis.com",
  ]) : toset([])
  service            = each.value
  disable_on_destroy = false
}

# The privileged lifecycle identity that runs the suspend build.
resource "google_service_account" "lifecycle" {
  count        = local.auto_suspend_on ? 1 : 0
  account_id   = "${local.name_prefix}-lifecycle"
  display_name = "DevStash ${var.environment} lifecycle (idle auto-suspend)"
}

resource "google_project_iam_member" "lifecycle" {
  for_each = toset(local.lifecycle_roles)
  project  = var.project_id
  role     = each.value
  member   = "serviceAccount:${google_service_account.lifecycle[0].email}"
}

# Read/write the Terraform state object (+ lock) — scoped to the state bucket, not project.
resource "google_storage_bucket_iam_member" "lifecycle_state" {
  count  = local.auto_suspend_on ? 1 : 0
  bucket = local.tfstate_bucket
  role   = "roles/storage.objectAdmin"
  member = "serviceAccount:${google_service_account.lifecycle[0].email}"
}

# The dump step's VERIFY (`gcloud storage objects describe`) reads the exported object as
# the lifecycle SA, so it needs read on the db-dumps bucket. Read-only is enough: the
# actual export WRITE is performed by the Cloud SQL service agent (objectAdmin granted in
# db-dumps.tf), not this SA. Scoped to the dump bucket, not the project.
resource "google_storage_bucket_iam_member" "lifecycle_db_dumps" {
  count  = local.auto_suspend_on ? 1 : 0
  bucket = google_storage_bucket.db_dumps.name
  role   = "roles/storage.objectViewer"
  member = "serviceAccount:${google_service_account.lifecycle[0].email}"
}

# The delete-registry step (step 5) deletes the WHOLE repo. No predefined role scopes just
# repository deletion (repoAdmin covers deleteArtifacts but NOT repositories.delete), and
# project-wide artifactregistry.admin is far broader than needed — so mint a custom role with
# exactly the two permissions `gcloud artifacts repositories delete` calls, then bind it to
# THIS repo only. Same repo-scoped least-privilege posture as the node reader in modules/iam.
resource "google_project_iam_custom_role" "lifecycle_ar_deleter" {
  count       = local.auto_suspend_on ? 1 : 0
  role_id     = "${replace(local.name_prefix, "-", "_")}_ar_repo_deleter"
  title       = "DevStash ${var.environment} AR repo deleter (idle auto-suspend)"
  description = "Delete the Artifact Registry repo on deep-suspend so idle storage is $0."
  permissions = [
    "artifactregistry.repositories.delete",
    "artifactregistry.repositories.get",
  ]
}

resource "google_artifact_registry_repository_iam_member" "lifecycle_ar_delete" {
  count      = local.auto_suspend_on ? 1 : 0
  project    = var.project_id
  location   = var.region
  repository = module.artifact_registry.repository_id
  role       = google_project_iam_custom_role.lifecycle_ar_deleter[0].id
  member     = "serviceAccount:${google_service_account.lifecycle[0].email}"
}

# Pub/Sub-triggered builds run as the trigger's service_account via the Cloud Build service
# agent, which must be able to actAs the lifecycle SA.
resource "google_service_account_iam_member" "lifecycle_actas" {
  count              = local.auto_suspend_on ? 1 : 0
  service_account_id = google_service_account.lifecycle[0].name
  role               = "roles/iam.serviceAccountUser"
  member             = "serviceAccount:${local.cloudbuild_agent}"

  depends_on = [google_project_service.auto_suspend]
}

# Topic the idle alert publishes to and the build trigger subscribes to.
resource "google_pubsub_topic" "auto_suspend" {
  count  = local.auto_suspend_on ? 1 : 0
  name   = "${local.name_prefix}-auto-suspend"
  labels = local.common_labels

  depends_on = [google_project_service.auto_suspend]
}

# Force-create Cloud Monitoring's notification service agent. This agent
# (service-<num>@gcp-sa-monitoring-notification.iam.gserviceaccount.com) is otherwise
# provisioned lazily by GCP, so granting it pubsub.publisher below on a fresh project
# fails with "Service account …@gcp-sa-monitoring-notification… does not exist".
# google_project_service_identity provisions it up front so the IAM binding + the pubsub
# notification channel can reference it deterministically. (The monitoring API itself is
# enabled by the base stack; this only materialises the agent identity.)
resource "google_project_service_identity" "monitoring_notification" {
  provider = google-beta
  count    = local.auto_suspend_on ? 1 : 0
  service  = "monitoring.googleapis.com"
}

# Bridge GCP's eventual-consistency gap: the service agent above is created, but IAM does
# not see it for a few seconds, so granting pubsub.publisher immediately fails with
# "Service account …@gcp-sa-monitoring-notification… does not exist" even though the agent
# now exists. A short sleep between creation and the grant is the documented workaround
# (hashicorp/terraform-provider-google#21931). Only in the create path — no destroy delay.
resource "time_sleep" "monitoring_identity_propagation" {
  count           = local.auto_suspend_on ? 1 : 0
  depends_on      = [google_project_service_identity.monitoring_notification]
  create_duration = "60s"
}

# Let Cloud Monitoring's notification service agent publish to the topic.
resource "google_pubsub_topic_iam_member" "monitoring_publisher" {
  count      = local.auto_suspend_on ? 1 : 0
  topic      = google_pubsub_topic.auto_suspend[0].id
  role       = "roles/pubsub.publisher"
  member     = google_project_service_identity.monitoring_notification[0].member
  depends_on = [time_sleep.monitoring_identity_propagation]
}

# Let the Cloud Scheduler service agent publish the hard-uptime-cap tick to the same topic.
resource "google_pubsub_topic_iam_member" "scheduler_publisher" {
  count  = local.auto_suspend_on ? 1 : 0
  topic  = google_pubsub_topic.auto_suspend[0].id
  role   = "roles/pubsub.publisher"
  member = "serviceAccount:${local.cloudscheduler_agent}"

  depends_on = [google_project_service.auto_suspend]
}

# Scanner-proof backstop. The idle ALERT only fires on metric ABSENCE (zero ingress
# traffic), which public-IP scanner noise defeats — so on its own the env can stay up
# indefinitely. This cron publishes to the SAME topic on a fixed cadence regardless of
# traffic; the guard then suspends unconditionally once the cluster is older than
# _MAX_UPTIME (and still, separately, on the zero-traffic path). Cloud Scheduler's first 3
# jobs/mo are free, so this backstop is itself ~$0. The message body is inert — the guard
# reads live cluster state + metrics, never the payload.
resource "google_cloud_scheduler_job" "auto_suspend_uptime_cap" {
  count       = local.auto_suspend_on ? 1 : 0
  name        = "${local.name_prefix}-auto-suspend-uptime-cap"
  region      = var.region
  description = "Fire the idle auto-suspend guard on a fixed cadence so the hard uptime cap applies even when public-IP scanner traffic keeps the LB metric non-absent."
  schedule    = var.auto_suspend_schedule_cron
  time_zone   = "America/Chicago" # us-central1 (Iowa) local time

  pubsub_target {
    topic_name = google_pubsub_topic.auto_suspend[0].id
    data       = base64encode("uptime-cap-check")
  }

  depends_on = [
    google_project_service.auto_suspend,
    google_pubsub_topic_iam_member.scheduler_publisher,
  ]
}

# Pub/Sub notification channel wrapping the topic.
resource "google_monitoring_notification_channel" "auto_suspend" {
  count        = local.auto_suspend_on ? 1 : 0
  display_name = "DevStash ${var.environment} idle auto-suspend"
  type         = "pubsub"

  labels = {
    topic = google_pubsub_topic.auto_suspend[0].id
  }

  depends_on = [google_pubsub_topic_iam_member.monitoring_publisher]
}

# Alert: fires when the ingress LB reports NO request_count for the idle window. A
# zero-traffic external HTTP LB stops emitting request_count points, so metric-absence is
# the right condition. In-cluster health/readiness probes never touch the LB, so they don't
# keep it "busy". The build re-checks anyway before acting.
resource "google_monitoring_alert_policy" "auto_suspend" {
  count        = local.auto_suspend_on ? 1 : 0
  display_name = "DevStash ${var.environment} idle (no ingress traffic)"
  combiner     = "OR"

  conditions {
    display_name = "No ingress LB requests for the idle window"
    condition_absent {
      filter   = "resource.type=\"https_lb_rule\" AND metric.type=\"loadbalancing.googleapis.com/https/request_count\""
      duration = "${var.auto_suspend_idle_window_seconds}s"
      aggregations {
        alignment_period     = "300s"
        per_series_aligner   = "ALIGN_SUM"
        cross_series_reducer = "REDUCE_SUM"
      }
    }
  }

  notification_channels = [google_monitoring_notification_channel.auto_suspend[0].id]
}

# Pub/Sub-triggered build. No repo connection — step 1 clones the public repo itself. The
# idle re-check (guard) writes a sentinel; prepare + suspend run only if it's present.
resource "google_cloudbuild_trigger" "auto_suspend" {
  count           = local.auto_suspend_on ? 1 : 0
  name            = "${local.name_prefix}-auto-suspend"
  location        = var.region
  description     = "Idle: re-check traffic, dump Cloud SQL to GCS, then tofu apply -var environment_active=false -var db_active=false."
  service_account = google_service_account.lifecycle[0].id

  pubsub_config {
    topic = google_pubsub_topic.auto_suspend[0].id
  }

  substitutions = {
    _PROJECT_ID    = var.project_id
    _REGION        = var.region
    _STATE_BUCKET  = local.tfstate_bucket
    _REPO_SLUG     = var.github_repository
    _REPO_BRANCH   = var.auto_suspend_repo_branch
    _SECRET_KEYS   = local.auto_suspend_secret_keys
    _NONSECRET_B64 = local.auto_suspend_nonsecret_tfvars
    _IDLE_WINDOW   = tostring(var.auto_suspend_idle_window_seconds)
    # Hard uptime cap — the guard suspends unconditionally once the cluster is older than
    # this, regardless of traffic (scanner-proof backstop; see the scheduler below).
    _MAX_UPTIME = tostring(var.auto_suspend_max_uptime_seconds)
    # Deep-suspend DB round trip — dump the instance to GCS before the apply destroys it.
    # Same instance / bucket / object run.sh uses (db_dump_object output), so this path and
    # `run.sh resume` always agree on which dump to write and read.
    _DB_INSTANCE     = local.db_instance_name
    _DB_DUMPS_BUCKET = google_storage_bucket.db_dumps.name
    _DB_DUMP_OBJECT  = local.db_dump_object
    # Artifact Registry repo — the delete-registry step removes the whole repo for $0 idle
    # storage (resume's full-refresh apply recreates it; CI rebuilds + repushes). Same repo
    # id run.sh delete_registry uses.
    _AR_REPO = module.artifact_registry.repository_id
  }

  build {
    timeout = "3600s"
    options {
      logging             = "CLOUD_LOGGING_ONLY"
      substitution_option = "ALLOW_LOOSE"
    }

    # 1 — GUARD. Suspend only if the cluster exists, is older than the idle window (grace
    #     for a fresh resume), and served zero LB requests across the window. Writes a
    #     sentinel that the later steps require. Any other case is a clean no-op.
    step {
      id     = "guard"
      name   = "gcr.io/google.com/cloudsdktool/cloud-sdk:stable"
      env    = local.auto_suspend_build_env
      script = file("${path.module}/scripts/auto-suspend-guard.sh")
    }

    # 2 — PREPARE (only if idle). Clone the repo, drop the non-secret tfvars, reconstruct
    #     app/Spaceship secrets from Secret Manager into tofu-autoloaded *.auto.tfvars.json.
    step {
      id     = "prepare"
      name   = "gcr.io/google.com/cloudsdktool/cloud-sdk:stable"
      env    = local.auto_suspend_build_env
      script = file("${path.module}/scripts/auto-suspend-prepare.sh")
    }

    # 3 — DUMP (only if idle). Export the live DB to the GCS db-dumps bucket and VERIFY the
    #     object is non-empty BEFORE the destroy step runs. This is the same server-side
    #     `gcloud sql export` run.sh uses (the Cloud SQL service agent writes to GCS). `set
    #     -eu` + the explicit non-empty check mean a failed/empty dump exits non-zero, which
    #     fails the build so the suspend step below NEVER destroys an un-dumped instance.
    step {
      id     = "dump"
      name   = "gcr.io/google.com/cloudsdktool/cloud-sdk:stable"
      env    = local.auto_suspend_build_env
      script = file("${path.module}/scripts/auto-suspend-dump.sh")
    }

    # 4 — SUSPEND (only if idle). Now that the verified dump exists, drive to ~$0: destroy
    #     compute AND the Cloud SQL instance (db_active=false). -refresh=false keeps the
    #     apply (and this SA's perms) scoped to just what these two vars change.
    step {
      id     = "suspend"
      name   = "ghcr.io/opentofu/opentofu:1.12.3"
      env    = local.auto_suspend_build_env
      script = file("${path.module}/scripts/auto-suspend-suspend.sh")
    }

    # 5 — DELETE REGISTRY (only if idle). Delete the whole Artifact Registry repo so idle
    #     storage is $0 (the last cost above the always-free tier). Runs after the tofu
    #     suspend — off the critical dump→destroy path — and is best-effort (a delete failure
    #     does not fail the build; resume's apply recreates the repo and CI repushes).
    step {
      id     = "delete-registry"
      name   = "gcr.io/google.com/cloudsdktool/cloud-sdk:stable"
      env    = local.auto_suspend_build_env
      script = file("${path.module}/scripts/auto-suspend-delete-repo.sh")
    }
  }

  depends_on = [
    google_project_service.auto_suspend,
    google_project_iam_member.lifecycle,
    google_service_account_iam_member.lifecycle_actas,
    google_storage_bucket_iam_member.lifecycle_db_dumps,
    google_artifact_registry_repository_iam_member.lifecycle_ar_delete,
  ]
}
