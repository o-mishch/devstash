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
  #   memorystore.admin      delete Memorystore for Valkey
  #   compute.networkAdmin   delete ingress IP + Cloud Router + Cloud NAT
  #   compute.securityAdmin  delete the Cloud Armor policy
  #   cloudsql.admin         export the DB to GCS + DESTROY the instance (db_active=false)
  #   secretmanager.admin    delete the redis-* + database-* secrets; read all for reconstruction
  #   monitoring.viewer      read request_count for the idle re-check
  #   browser                data.google_project (resourcemanager.projects.get)
  #   cloudkms.viewer        data.google_kms_crypto_key_version (binauthz signer — ungated)
  #   logging.logWriter      Cloud Build custom-SA builds must write their own logs
  #   cloudbuild.builds.editor
  #                          step 6 lists + cancels in-flight builds (cloudbuild.builds.list /
  #                          .update). No narrower predefined role exists (viewer can't cancel);
  #                          this role's write surface is only over Cloud Build builds — it
  #                          cannot start/mutate anything else — so it is the minimal grant.
  #   serviceusage.serviceUsageConsumer
  #                          the provider runs with user_project_override + billing_project
  #                          (providers.tf, mandatory for the Billing Budgets API), so every
  #                          API call sends an X-Goog-User-Project header attributed to this
  #                          project — which requires serviceusage.services.use on it. Without
  #                          it the db-dumps bucket-IAM destroy 403s ("does not have
  #                          serviceusage.services.use access") AFTER Valkey/NAT/IP are gone
  #                          but BEFORE the Cloud SQL destroy, stranding a billing instance.
  #                          This predefined role is the minimal grant (its only meaningful
  #                          permission is services.use); it lets the SA attribute calls to
  #                          the project it already operates on — not an escalation. Must be
  #                          PROJECT-scoped (a bucket-level binding can't carry it).
  #
  # NOTE: there is deliberately NO self-updater role for the auto-suspend's own alert policy +
  # Cloud Build trigger. Those always-on resources used to plan an in-place update on every
  # suspend apply because auto_suspend_* vars were omitted from auto_suspend_nonsecret_tfvars
  # and fell back to their defaults (idle_window 1800 -> 300), forcing a self-diff the SA had
  # to be able to write. Feeding the real auto_suspend_* values into that tfvars blob makes
  # the suspend apply render byte-identical config → zero self-diff → no self-update
  # permission needed. Removing the cause is safer than permitting the symptom.
  lifecycle_roles = local.auto_suspend_on ? [
    "roles/container.admin",
    "roles/memorystore.admin",
    "roles/compute.networkAdmin",
    "roles/compute.securityAdmin",
    "roles/cloudsql.admin",
    "roles/secretmanager.admin",
    "roles/monitoring.viewer",
    "roles/browser",
    "roles/cloudkms.viewer",
    "roles/logging.logWriter",
    "roles/cloudbuild.builds.editor",
    "roles/serviceusage.serviceUsageConsumer",
  ] : []

  # Non-secret tfvars for the headless apply — built from THIS module so the values match a
  # local apply exactly. environment_active is absent (forced to false on the command line);
  # secrets are reconstructed at runtime.
  #
  # The auto_suspend_* knobs MUST be included: the suspend build's apply runs -refresh=false,
  # comparing config against last-written state. If any auto_suspend_* var here fell back to
  # its variables.tf default (because it was omitted) while the operator's apply used a
  # terraform.tfvars override, the plan would "correct" the ALWAYS-ON trigger + Cloud
  # Scheduler + alert policy back to the default on every suspend — a self-inflicted in-place
  # update mid-teardown. That is exactly what stranded a prior run: idle_window drifted
  # 1800 (operator) -> 300 (default), the trigger update 403'd, tofu exited non-zero BEFORE
  # the Cloud SQL destroy AND before the delete-registry step, leaving both billing. Feeding
  # the real values in makes the suspend apply render byte-identical config → zero self-diff.
  auto_suspend_nonsecret_tfvars = base64encode(jsonencode({
    project_id                       = var.project_id
    project_number                   = var.project_number
    region                           = var.region
    environment                      = var.environment
    github_repository                = var.github_repository
    github_owner_id                  = var.github_owner_id
    app_domain                       = var.app_domain
    email_from                       = var.email_from
    billing_account                  = var.billing_account
    monthly_budget_amount            = var.monthly_budget_amount
    db_tier                          = var.db_tier
    db_authorized_networks           = var.db_authorized_networks
    db_point_in_time_recovery        = var.db_point_in_time_recovery
    db_highly_available              = var.db_highly_available
    memory_highly_available          = var.memory_highly_available
    armor_waf_preview                = var.armor_waf_preview
    deletion_protection              = var.deletion_protection
    auto_suspend_enabled             = var.auto_suspend_enabled
    auto_suspend_idle_window_seconds = var.auto_suspend_idle_window_seconds
    auto_suspend_max_uptime_seconds  = var.auto_suspend_max_uptime_seconds
    auto_suspend_schedule_cron       = var.auto_suspend_schedule_cron
    auto_suspend_repo_branch         = var.auto_suspend_repo_branch
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
    "_DB_DUMP_KEEP=$_DB_DUMP_KEEP",
    "_AR_REPO=$_AR_REPO",
    # Cloud Build's own build id (built-in $BUILD_ID substitution) — step 6 excludes it when
    # cancelling in-flight builds so the suspend build never cancels itself.
    "_BUILD_ID=$_BUILD_ID",
  ]

  # Pub/Sub + Cloud Build + Cloud Scheduler service agents (data.google_project is declared
  # in budget.tf). Needed so Cloud Build can run the build as the lifecycle SA and the
  # scheduler can publish the uptime-cap tick. (The monitoring-notification agent is
  # force-created via google_project_service_identity instead of hardcoded here, because it
  # is provisioned lazily and a hardcoded email races its creation on a fresh project.)
  cloudbuild_agent     = "service-${data.google_project.current.number}@gcp-sa-cloudbuild.iam.gserviceaccount.com"
  cloudscheduler_agent = "service-${data.google_project.current.number}@gcp-sa-cloudscheduler.iam.gserviceaccount.com"

  # Builder images pinned by DIGEST, not just a mutable tag. cloud-sdk:stable silently dropped
  # git (and later python3) across rebuilds — twice breaking this suspend build — precisely
  # because a tag is mutable and Google ships these images with --no-install-recommends. Pinning
  # the digest freezes the exact image so its binary set can never change beneath us again; the
  # tag is kept alongside purely as human-readable documentation. Tradeoff: no automatic security
  # refresh — bump these deliberately (docker pull <img>:<tag> && docker buildx imagetools
  # inspect <img>:<tag> --format '{{.Manifest.Digest}}', then paste the new digest here) and
  # re-run infra/ci/auto-suspend-image-check.sh before applying.
  #
  # cloud-sdk:slim is the Google-recommended variant that PREINSTALLS gcloud + python3 + git +
  # ca-certificates (unlike :stable, which is gcloud + bq only). We use it so the step scripts
  # install NOTHING at runtime (no apt-get, no network-dependent package fetch) and so each
  # language stays in its own file — the guard/prepare Python lives in standalone *.py helpers
  # invoked with `python3`, never inlined into the shell. It is larger than :stable, which is the
  # deliberate tradeoff for zero installs + clean language segregation.
  cloud_sdk_image = "gcr.io/google.com/cloudsdktool/cloud-sdk:slim@sha256:7805e8f25c698ac26606177ae77f1d68a14e6e276570bab4ecbb75de898cb4cb"
  opentofu_image  = "ghcr.io/opentofu/opentofu:1.12.3@sha256:a0766d12f07b43e66f2ed40d7a8babe97d581d20339c68ad0ab561737af9a5b3"
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
# the lifecycle SA, so it needs read on the db-dumps bucket. Read-only is enough for the
# verify: the actual export WRITE is performed by the Cloud SQL service agent (objectAdmin
# granted in db-dumps.tf), not this SA. Scoped to the dump bucket, not the project.
resource "google_storage_bucket_iam_member" "lifecycle_db_dumps" {
  count  = local.auto_suspend_on ? 1 : 0
  bucket = google_storage_bucket.db_dumps.name
  role   = "roles/storage.objectViewer"
  member = "serviceAccount:${google_service_account.lifecycle[0].email}"
}

# The suspend apply also DESTROYS the db-dumps bucket's sql_agent_db_dumps binding — that
# grant targets the Cloud SQL instance's PER-INSTANCE service agent (p<num>-<hash>@…), which
# ceases to exist when db_active=false destroys the instance, so the binding cannot be kept
# stable (unlike the compute-default-SA bindings, which were made static). Removing a
# bucket IAM member reads then rewrites the bucket policy, so the lifecycle SA needs
# get/getIamPolicy/setIamPolicy on THIS bucket. No predefined role is that narrow without
# also granting object/bucket create+delete (roles/storage.admin), so mint a custom role
# with exactly the three permissions the destroy calls, bound to the db-dumps bucket ONLY.
# This is NOT project-level setIamPolicy — same one-bucket, custom-role least-privilege
# posture as lifecycle_ar_deleter. (The separate project-level serviceusage.services.use the
# bucket-IAM rewrite ALSO needs is granted via roles/serviceusage.serviceUsageConsumer in
# lifecycle_roles above — a bucket-scoped binding can't carry that project-resource perm.)
resource "google_project_iam_custom_role" "lifecycle_db_dumps_iam" {
  count       = local.auto_suspend_on ? 1 : 0
  role_id     = "${replace(local.name_prefix, "-", "_")}_db_dumps_iam_admin"
  title       = "DevStash ${var.environment} db-dumps IAM admin (idle auto-suspend)"
  description = "Read+write the db-dumps bucket IAM policy so the suspend apply can remove the per-instance Cloud SQL agent's objectAdmin binding when the instance is destroyed."
  permissions = [
    "storage.buckets.get",
    "storage.buckets.getIamPolicy",
    "storage.buckets.setIamPolicy",
  ]
}

resource "google_storage_bucket_iam_member" "lifecycle_db_dumps_iam" {
  count  = local.auto_suspend_on ? 1 : 0
  bucket = google_storage_bucket.db_dumps.name
  role   = google_project_iam_custom_role.lifecycle_db_dumps_iam[0].id
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

# Step 6 (cleanup) deletes the ${project}_cloudbuild source-staging bucket. That bucket is
# auto-created by GCP on first build use — it is NOT Terraform-managed, and it may not exist at
# apply time — so a bucket-scoped IAM binding can't reference it (no resource to attach to, and
# a literal-name binding 404s when the bucket is absent). Grant the delete permissions with a
# PROJECT-scoped custom role instead: exactly the four perms `gcloud storage rm -r` on a bucket
# calls (list + delete objects, then delete the bucket), nothing wider than storage.admin would
# add. project-scoped so it doesn't depend on the bucket existing; the SA can only ever act on
# buckets it already has resource access to, and these perms are storage-delete only.
resource "google_project_iam_custom_role" "lifecycle_staging_deleter" {
  count       = local.auto_suspend_on ? 1 : 0
  role_id     = "${replace(local.name_prefix, "-", "_")}_cloudbuild_staging_deleter"
  title       = "DevStash ${var.environment} Cloud Build staging deleter (idle auto-suspend)"
  description = "Delete the ${var.project_id}_cloudbuild source-staging bucket on deep-suspend so idle Cloud Build storage is $0."
  permissions = [
    "storage.objects.list",
    "storage.objects.delete",
    "storage.buckets.get",
    "storage.buckets.delete",
  ]
}

resource "google_project_iam_member" "lifecycle_staging_deleter" {
  count   = local.auto_suspend_on ? 1 : 0
  project = var.project_id
  role    = google_project_iam_custom_role.lifecycle_staging_deleter[0].id
  member  = "serviceAccount:${google_service_account.lifecycle[0].email}"
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
    # Noncurrent-dump retention count (same var the lifecycle rule + run.sh dump_db use). The
    # dump step force-prunes the history to this + 1 total generations right after writing, so
    # the event-driven idle suspend caps dump history immediately instead of waiting for the
    # bucket's ~daily lifecycle sweep — same "on each touch" behaviour as the laptop path.
    _DB_DUMP_KEEP = var.db_dump_keep_versions
    # Artifact Registry repo — the delete-registry step removes the whole repo for $0 idle
    # storage (resume's full-refresh apply recreates it; CI rebuilds + repushes). Same repo
    # id run.sh delete_registry uses.
    _AR_REPO = module.artifact_registry.repository_id
    # This build's own id — step 6 excludes it so cancelling in-flight builds never cancels
    # the suspend build itself. $BUILD_ID is a Cloud Build built-in substitution; ALLOW_LOOSE
    # (options below) lets a user substitution reference it.
    _BUILD_ID = "$BUILD_ID"
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
      name   = local.cloud_sdk_image
      env    = local.auto_suspend_build_env
      script = file("${path.module}/scripts/auto-suspend-guard.sh")
    }

    # 2 — PREPARE (only if idle). Clone the repo, drop the non-secret tfvars, reconstruct
    #     app/Spaceship secrets from Secret Manager into tofu-autoloaded *.auto.tfvars.json.
    step {
      id     = "prepare"
      name   = local.cloud_sdk_image
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
      name   = local.cloud_sdk_image
      env    = local.auto_suspend_build_env
      script = file("${path.module}/scripts/auto-suspend-dump.sh")
    }

    # 4 — SUSPEND (only if idle). Now that the verified dump exists, drive to ~$0: destroy
    #     compute AND the Cloud SQL instance (db_active=false). -refresh=false keeps the
    #     apply (and this SA's perms) scoped to just what these two vars change.
    step {
      id     = "suspend"
      name   = local.opentofu_image
      env    = local.auto_suspend_build_env
      script = file("${path.module}/scripts/auto-suspend-suspend.sh")
    }

    # 5 — DELETE REGISTRY (only if idle). Delete the whole Artifact Registry repo so idle
    #     storage is $0 (the last cost above the always-free tier). Runs after the tofu
    #     suspend — off the critical dump→destroy path — and is best-effort (a delete failure
    #     does not fail the build; resume's apply recreates the repo and CI repushes).
    step {
      id     = "delete-registry"
      name   = local.cloud_sdk_image
      env    = local.auto_suspend_build_env
      script = file("${path.module}/scripts/auto-suspend-delete-repo.sh")
    }

    # 6 — CLEANUP BUILDS (only if idle). Cancel any OTHER in-flight build and delete the
    #     ${project}_cloudbuild source-staging bucket so a suspended env holds no lingering
    #     Cloud Build state/storage. Runs last, off the critical path, best-effort (a failure
    #     never fails the build). Build RECORDS can't be deleted (no Cloud Build delete API);
    #     build logs are left alone so the failure-alert log-metric keeps its ERROR counts.
    step {
      id     = "cleanup-builds"
      name   = local.cloud_sdk_image
      env    = local.auto_suspend_build_env
      script = file("${path.module}/scripts/auto-suspend-cleanup-builds.sh")
    }
  }

  depends_on = [
    google_project_service.auto_suspend,
    google_project_iam_member.lifecycle,
    google_service_account_iam_member.lifecycle_actas,
    google_storage_bucket_iam_member.lifecycle_db_dumps,
    google_storage_bucket_iam_member.lifecycle_db_dumps_iam,
    google_artifact_registry_repository_iam_member.lifecycle_ar_delete,
    google_project_iam_member.lifecycle_staging_deleter,
  ]
}

# --- Suspend-build FAILURE alerting ----------------------------------------
# The suspend build failing is INVISIBLE by default: it fails on the scheduler's cadence, the
# env silently stays up (bleeding ~$0.13/hr), and nothing pages anyone — exactly how the
# disabled-secret + IAM-replace bugs ran unnoticed for hours. Cloud Build publishes NO native
# monitoring metric, so the recommended pattern is a LOG-BASED metric over the build's own audit
# log + a threshold alert. The build already logs to Cloud Logging (CLOUD_LOGGING_ONLY), and a
# failed build of this trigger emits one terminal audit entry (operation.last=true, severity
# ERROR) tagged with the trigger id — a clean one-count-per-failed-build signal.

# Bare address for the email channel: var.email_from is display-name formatted
# ("DevStash <noreply@host>"); extract just the address. Falls back to the whole string if it
# is already bare (no angle brackets).
locals {
  auto_suspend_alert_email = try(regex("<([^>]+)>", var.email_from)[0], var.email_from)
}

# Log-based counter: one increment per FAILED build of the auto-suspend trigger. operation.last
# = the terminal completion entry (not the per-step noise); severity=ERROR = the build failed.
resource "google_logging_metric" "auto_suspend_build_failures" {
  count  = local.auto_suspend_on ? 1 : 0
  name   = "${local.name_prefix}-auto-suspend-build-failures"
  filter = <<-EOT
    resource.type="build"
    resource.labels.build_trigger_id="${google_cloudbuild_trigger.auto_suspend[0].trigger_id}"
    severity=ERROR
    operation.last=true
  EOT
  metric_descriptor {
    metric_kind = "DELTA"
    value_type  = "INT64"
  }
}

# Email channel — reuses the transactional-email address (var.email_from). No new var/secret;
# the address is non-secret config already in the module.
resource "google_monitoring_notification_channel" "auto_suspend_ops_email" {
  count        = local.auto_suspend_on ? 1 : 0
  display_name = "DevStash ${var.environment} auto-suspend ops"
  type         = "email"
  labels = {
    email_address = local.auto_suspend_alert_email
  }
}

# Alert: fire once the suspend build has failed repeatedly — a persistent problem, not a
# one-off raced apply. The scheduler fires every 15 min, so ≥3 failures across a rolling hour
# (threshold 2 = "more than 2") means suspend has been wedged for ~45 min and the env is still
# up. Sends to the ops email so a broken teardown is caught same-hour instead of silently
# billing for days.
resource "google_monitoring_alert_policy" "auto_suspend_build_failures" {
  count        = local.auto_suspend_on ? 1 : 0
  display_name = "DevStash ${var.environment} auto-suspend build failing"
  combiner     = "OR"

  conditions {
    display_name = "Suspend build failed 3+ times in an hour"
    condition_threshold {
      filter          = "resource.type=\"build\" AND metric.type=\"logging.googleapis.com/user/${google_logging_metric.auto_suspend_build_failures[0].name}\""
      comparison      = "COMPARISON_GT"
      threshold_value = 2
      duration        = "0s"
      aggregations {
        alignment_period   = "3600s"
        per_series_aligner = "ALIGN_SUM"
      }
      trigger {
        count = 1
      }
    }
  }

  notification_channels = [google_monitoring_notification_channel.auto_suspend_ops_email[0].id]

  documentation {
    content   = "The idle auto-suspend Cloud Build has failed repeatedly, so the ${var.environment} environment is NOT tearing down and is still billing. Check the latest build: gcloud builds list --region=${var.region} --filter=\"tags:auto-suspend\" (or the trigger's build history), fix the failing step, then re-trigger by publishing to the ${local.name_prefix}-auto-suspend topic. See infra/terraform/envs/dev/auto-suspend.tf."
    mime_type = "text/markdown"
  }
}
