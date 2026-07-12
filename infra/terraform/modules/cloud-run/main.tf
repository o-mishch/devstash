# Cloud Run v2 service + its custom domain mapping. Freshly created in us-central1 (the live
# europe-west1 service is NOT imported — this is a real region migration per the region decision;
# see envs/prod's README cutover runbook). The lifecycle.ignore_changes block below still applies
# from day one because Cloud Build starts updating the image out-of-band right after first apply.

resource "google_cloud_run_v2_service" "app" {
  name     = var.name
  project  = var.project_id
  location = var.region

  # Prod default: the service must survive an accidental `tofu destroy`/apply-with-removed-
  # resource. Unlike dev's GKE/Cloud SQL (deliberately unprotected — they're destroyed every
  # suspend cycle by design), this service has no suspend/resume lifecycle, so protecting it is
  # pure upside.
  deletion_protection = var.deletion_protection

  ingress = var.ingress

  scaling {
    min_instance_count = var.min_instance_count
    max_instance_count = var.max_instance_count
  }

  template {
    service_account = var.service_account_email != "" ? var.service_account_email : null

    containers {
      image = var.image

      dynamic "env" {
        for_each = var.env
        content {
          name = env.value.name
          # Plain value only when this entry is NOT a secret ref (value must be unset when
          # value_source is present, or the API rejects the container).
          value = env.value.secret_name == null ? env.value.value : null

          dynamic "value_source" {
            for_each = env.value.secret_name != null ? [1] : []
            content {
              secret_key_ref {
                secret  = env.value.secret_name
                version = env.value.secret_version
              }
            }
          }
        }
      }

      resources {
        cpu_idle          = var.cpu_idle
        startup_cpu_boost = var.startup_cpu_boost
        limits = {
          cpu    = var.cpu
          memory = var.memory
        }
      }
    }
  }

  labels = var.labels

  # No `traffic` block: an empty/omitted block defaults to 100% traffic on the latest Ready
  # revision (the provider's own documented default), which is what a single-revision service
  # with no manual traffic split already looks like. If the live service ever gets a manual
  # split, `tofu plan -generate-config-out` during import will surface it — add an explicit
  # `traffic` block then rather than guessing one in now.
  lifecycle {
    ignore_changes = [
      # Cloud Build's `gcloud run services update` sets these on every CI-driven deploy —
      # Terraform must not fight a deploy pipeline it doesn't own the image lifecycle of.
      client,
      client_version,
      template[0].containers[0].image,
      # Cloud Run injects/rewrites its own annotations (e.g. run.googleapis.com/operation-id,
      # client.knative.dev/user-image) on every revision — these churn independently of any
      # config Terraform actually owns.
      template[0].annotations,
    ]
  }
}

# Public invoker binding — a browser-facing API must accept UNAUTHENTICATED requests at the
# Cloud Run IAM layer (browsers can't present GCP IAM tokens); the app does its own session auth.
# Without this the service defaults to "Require authentication" and returns 403 to the SPA. Gated
# so non-public callers (internal services) can leave it off. Matches the live service's posture.
resource "google_cloud_run_v2_service_iam_member" "public" {
  count = var.allow_unauthenticated ? 1 : 0

  project  = var.project_id
  location = var.region
  name     = google_cloud_run_v2_service.app.name
  role     = "roles/run.invoker"
  member   = "allUsers"
}

resource "google_cloud_run_domain_mapping" "app" {
  # Domain mapping is a deliberate $0 choice, not the production-grade path. Google's own docs flag
  # it as preview / not-recommended-for-prod (added latency) and steer production custom domains to
  # a global external Application Load Balancer (custom TLS, Cloud CDN, Cloud Armor) — but that LB's
  # forwarding rule is ~$18/mo, which breaks this env's $0 mandate. Mapping is region-limited;
  # us-central1 IS supported, and it's already what the live service uses. Revisit the LB path only
  # if the latency/feature ceiling actually bites.
  #
  # Gated separately from `domain` so a caller can stand the service up first and cut the domain
  # over later — a custom domain can only map to ONE Cloud Run service at a time, so creating this
  # while the domain is still mapped to another (e.g. an old-region) service would fail on apply.
  count = var.domain != "" && var.create_domain_mapping ? 1 : 0

  name     = var.domain
  location = var.region
  project  = var.project_id

  metadata {
    namespace = var.project_id
  }

  spec {
    route_name = google_cloud_run_v2_service.app.name
  }
}
