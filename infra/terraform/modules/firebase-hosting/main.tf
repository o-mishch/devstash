# Firebase Hosting (classic) — cloud-side infra only. The actual `web/` Vite app,
# `web/firebase.json`, `.firebaserc`, and the GitHub Actions deploy workflow are Frontend
# Track F0 deliverables (see context/current-feature.md) and are explicitly NOT built here —
# this module just gives F0 something to deploy into, plus a keyless deployer identity.

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

# --- Keyless GitHub Actions deployer for the future `firebase deploy --only hosting` workflow ---
resource "google_service_account" "firebase_deployer" {
  account_id   = "devstash-firebase-deployer"
  display_name = "DevStash Firebase Hosting deployer (GitHub Actions)"
}

# roles/firebasehosting.admin is the narrowest predefined role that can deploy Hosting
# releases/versions — narrower than roles/firebase.admin, which spans every Firebase product.
resource "google_project_iam_member" "firebase_deployer" {
  project = var.project_id
  role    = "roles/firebasehosting.admin"
  member  = "serviceAccount:${google_service_account.firebase_deployer.email}"
}

# WIF pool/provider are NOT created here — dev's iam module already owns the single
# `github-actions` pool + `github` provider in this (shared) project, and its attribute_condition
# already pins repo + numeric owner id + refs/heads/main + ref_type==branch, which is exactly the
# posture the Firebase deploy workflow (main-only) needs. Recreating the pool would collide
# (ALREADY_EXISTS) across the two Terraform states. Instead we bind prod's own deployer SA to the
# existing pool's principalSet (scoped by attribute.repository). The pool name uses the project
# NUMBER (not id): projects/<number>/locations/global/workloadIdentityPools/<pool>.
locals {
  wif_pool_name     = "projects/${var.project_number}/locations/global/workloadIdentityPools/${var.wif_pool_id}"
  wif_provider_name = "${local.wif_pool_name}/providers/${var.wif_provider_id}"
}

resource "google_service_account_iam_member" "firebase_deployer_github_wif" {
  service_account_id = google_service_account.firebase_deployer.name
  role               = "roles/iam.workloadIdentityUser"
  member             = "principalSet://iam.googleapis.com/${local.wif_pool_name}/attribute.repository/${var.github_repository}"
}
