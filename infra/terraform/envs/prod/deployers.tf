# Dedicated, least-privilege Cloud Build deploy identities — one per track, both built from the
# shared cloudbuild-deployer-sa module (SA + Logs Writer + service-agent token-creator). They
# replace the legacy compute-default SA (which carried default project Editor) as the identity
# builds run AS.
#
# Scope note: this changes only the DEPLOY (build-time) identity. The Cloud Run service's RUNTIME
# identity stays the compute-default SA (the cloud-run module gets no service_account_email), so
# its APP_CONFIG secret access (secrets.tf) is untouched.

# --- Backend (Cloud Run) deployer -------------------------------------------------------------
module "backend_deployer" {
  source         = "../../modules/cloudbuild-deployer-sa"
  project_id     = var.project_id
  project_number = var.project_number
  account_id     = "devstash-backend-deployer"
  display_name   = "DevStash backend (Cloud Run) deployer (Cloud Build)"
  # run.developer is the least-privilege role that covers `gcloud run services update`
  # (run.services.update/get), narrower than roles/run.admin.
  project_roles = ["roles/run.developer"]
}

# Push the built image — repo-scoped to the prod Artifact Registry repo, not project-wide.
resource "google_artifact_registry_repository_iam_member" "backend_deployer_ar" {
  project    = var.project_id
  location   = var.region
  repository = module.artifact_registry.repository_id
  role       = "roles/artifactregistry.writer"
  member     = "serviceAccount:${module.backend_deployer.email}"
  # module.artifact_registry.repository_id is a STATIC output (no edge to the repo resource), so
  # add an explicit edge: on `tofu destroy` this member is then removed BEFORE the repo, avoiding
  # the getIamPolicy-on-a-vanished-repo 403 race (cf. the dev iam module's repository_depends_on).
  depends_on = [module.artifact_registry]
}

# Deploying a revision that RUNS AS the runtime SA requires actAs on it. The service runs as the
# compute-default SA (constructed in locals.tf), which this TF does not own, so target it by its
# resource id string rather than a resource reference.
resource "google_service_account_iam_member" "backend_deployer_runtime_actas" {
  service_account_id = "projects/${var.project_id}/serviceAccounts/${local.compute_default_sa_email}"
  role               = "roles/iam.serviceAccountUser"
  member             = "serviceAccount:${module.backend_deployer.email}"
}

# --- Frontend (Firebase Hosting) deployer -----------------------------------------------------
module "firebase_deployer" {
  source         = "../../modules/cloudbuild-deployer-sa"
  project_id     = var.project_id
  project_number = var.project_number
  # devstash-web-deployer, NOT devstash-firebase-deployer: the latter id is held for ~30 days by
  # a soft-deleted SA (a partial-apply during the 2026-07-13 deployer refactor destroyed the
  # original), so re-creating under that id 409s. Fresh id sidesteps it; the ghost auto-purges.
  account_id   = "devstash-web-deployer"
  display_name = "DevStash Firebase Hosting deployer (Cloud Build)"
  # firebasehosting.admin deploys Hosting; apiKeysViewer covers the config/API-key read the
  # Firebase CLI performs during deploy (per Google's Cloud Build -> Firebase guide). Both are
  # narrower than roles/firebase.admin.
  project_roles = ["roles/firebasehosting.admin", "roles/serviceusage.apiKeysViewer"]
}
