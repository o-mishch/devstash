# Firebase Hosting (classic) — cloud-side Hosting infra ONLY (single responsibility). The actual
# `web/` Vite app, `web/firebase.json`, and `.firebaserc` are Frontend Track F0 deliverables (see
# context/current-feature.md); this module just gives F0 something to deploy into. The deploy
# runs in Cloud Build (a `web/**`-scoped trigger in envs/prod, mirroring the backend's Cloud Run
# trigger) as a dedicated deployer SA that lives in the shared `cloudbuild-deployer-sa` module —
# NOT here, and NOT GitHub Actions. See envs/prod/deployers.tf + `module "web_cloudbuild_trigger"`.

resource "google_firebase_project" "default" {
  provider = google-beta
  project  = var.project_id
}

resource "google_firebase_hosting_site" "default" {
  provider = google-beta
  project  = var.project_id
  site_id  = var.hosting_site_id

  depends_on = [google_firebase_project.default]
}

# Spark (free) plan CustomDomains only have access to the GROUPED cert type — PROJECT_GROUPED/
# DEDICATED require Blaze. Hardcoded (not a variable) since it's a plan-tier fact, not a
# per-environment choice. wait_dns_verification = false: the transition subdomain's DNS isn't
# pointed here yet (web/ doesn't exist), so `apply` must not block waiting for records that
# can't resolve.
resource "google_firebase_hosting_custom_domain" "default" {
  provider = google-beta

  project       = var.project_id
  site_id       = google_firebase_hosting_site.default.site_id
  custom_domain = var.custom_domain

  cert_preference       = "GROUPED"
  wait_dns_verification = var.wait_dns_verification
  # NOTE: computed `required_dns_updates.check_time` is re-stamped by the Firebase API on every
  # read while the domain is HOST_UNHOSTED, so `plan` shows a perpetual no-op "1 to change" until
  # DNS is pointed (Frontend-F0), after which it clears. It's provider-decided, so `ignore_changes`
  # can't suppress it (OpenTofu warns it's redundant) — this is expected cosmetic churn, not drift.
}
