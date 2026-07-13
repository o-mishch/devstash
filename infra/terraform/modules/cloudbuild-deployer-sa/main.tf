# A dedicated, least-privilege identity a Cloud Build trigger runs builds AS — the modern
# user-specified-service-account pattern that replaces the legacy shared compute-default SA
# (which carries default project Editor). This module owns the parts EVERY Cloud Build deployer
# needs: the SA, Logs Writer (mandatory for CLOUD_LOGGING_ONLY builds), and the service-agent
# token-creator binding that lets a trigger impersonate it. Workload reach is passed in via
# var.project_roles; anything resource- or SA-scoped is the caller's job (see the `email` output).

resource "google_service_account" "deployer" {
  account_id   = var.account_id
  display_name = var.display_name
}

# logging.logWriter is always required; union it with the caller's workload roles, one binding each.
resource "google_project_iam_member" "roles" {
  for_each = toset(concat(["roles/logging.logWriter"], var.project_roles))
  project  = var.project_id
  role     = each.value
  member   = "serviceAccount:${google_service_account.deployer.email}"
}

# The Cloud Build service agent must be able to mint tokens for this SA so a trigger can run
# builds as it (roles/iam.serviceAccountTokenCreator on the SA itself).
resource "google_service_account_iam_member" "cloudbuild_impersonation" {
  service_account_id = google_service_account.deployer.name
  role               = "roles/iam.serviceAccountTokenCreator"
  member             = "serviceAccount:service-${var.project_number}@gcp-sa-cloudbuild.iam.gserviceaccount.com"
}
