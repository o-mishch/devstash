# Root module for the `prod` environment: Cloud Run (Go backend, built/deployed by Cloud
# Build) + Firebase Hosting (React frontend, deployed by a future GitHub Actions workflow —
# see context/current-feature.md Frontend Track F0). Deliberately NOT dev's GKE/Memorystore/
# Cloud SQL shape, and deliberately NOT carrying dev's suspend/resume machinery — this
# environment stays up permanently; Cloud Run's own min-instances=0 already gives scale-to-
# zero cost efficiency.

resource "google_project_service" "apis" {
  for_each = toset([
    "run.googleapis.com",
    "cloudbuild.googleapis.com",
    "artifactregistry.googleapis.com",
    "firebase.googleapis.com",
    "firebasehosting.googleapis.com",
    "iam.googleapis.com",
    "iamcredentials.googleapis.com",
    "sts.googleapis.com",
    "cloudresourcemanager.googleapis.com",
  ])
  service            = each.value
  disable_on_destroy = false
}

module "artifact_registry" {
  source     = "../../modules/artifact-registry"
  region     = var.region
  project_id = var.project_id
  # Always on — prod has no suspend/resume lifecycle (unlike dev's `create = var.environment_active`).
  create = true
  # OWN repo — dev's "devstash" repo is destroyed on every dev suspend (create = environment_active)
  # and this is a SHARED project, so prod must not reuse it. Same cleanup-policy shape as dev, but
  # keep_count raised for real Cloud Run rollback depth.
  repository_id = "devstash-prod"
  keep_count    = 5
  labels        = local.common_labels
  depends_on    = [google_project_service.apis]
}

module "cloud_run" {
  source     = "../../modules/cloud-run"
  project_id = var.project_id
  region     = var.region

  image               = var.cloud_run_initial_image
  min_instance_count  = var.cloud_run_min_instances
  max_instance_count  = var.cloud_run_max_instances
  env                 = var.app_env_vars
  domain              = var.app_domain
  deletion_protection = true
  # OFF by default — api.devstash.one is still mapped to the live europe-west1 service. Flip
  # var.enable_domain_mapping true ONLY after: (1) the us-central1 service is deployed + healthy,
  # (2) the old europe-west1 domain mapping is deleted. See the plan file's cutover runbook.
  create_domain_mapping = var.enable_domain_mapping
  # Matches the live service (startup-cpu-boost on, 1 vCPU / 512Mi).
  startup_cpu_boost = true
  # Public browser-facing API — allow unauthenticated invocations (app does its own session auth),
  # matching the live europe-west1 service's "Public access". Without this the SPA gets 403.
  allow_unauthenticated = true
  labels                = local.common_labels

  # The APP_CONFIG secret must exist before the service mounts it.
  depends_on = [google_project_service.apis, module.artifact_registry, google_secret_manager_secret_version.app_config]
}

module "cloudbuild_trigger" {
  source     = "../../modules/cloudbuild-trigger"
  project_id = var.project_id

  # Classic GitHub-App trigger (verified live — no 2nd-gen connection exists in this project,
  # see modules/cloudbuild-trigger/main.tf). trigger_name is the live resource's real,
  # immutable auto-generated name; github_owner/github_repo_name are split from
  # var.github_repository ("o-mishch/devstash").
  trigger_name     = var.cloudbuild_trigger_name
  description      = "Build and deploy to Cloud Run service ${module.cloud_run.service_name} on push to \"${var.cloudbuild_branch_filter}\""
  github_owner     = split("/", var.github_repository)[0]
  github_repo_name = split("/", var.github_repository)[1]

  branch_filter_regex      = var.cloudbuild_branch_filter
  deployer_service_account = local.compute_default_sa_email

  substitutions = {
    _AR_HOSTNAME   = "${var.region}-docker.pkg.dev"
    _AR_PROJECT_ID = var.project_id
    _AR_REPOSITORY = module.artifact_registry.repository_id
    _DEPLOY_REGION = var.region
    _PLATFORM      = "managed"
    _SERVICE_NAME  = module.cloud_run.service_name
    _TRIGGER_ID    = local.cloudbuild_trigger_id
  }

  build_images = ["$_AR_HOSTNAME/$_AR_PROJECT_ID/$_AR_REPOSITORY/$REPO_NAME/$_SERVICE_NAME:$COMMIT_SHA"]
  tags         = ["gcp-cloud-build-deploy-cloud-run", "gcp-cloud-build-deploy-cloud-run-managed", "devstash"]

  build_steps = [
    {
      id   = "Build"
      name = "gcr.io/cloud-builders/docker"
      args = [
        "build", "--no-cache",
        "-t", "$_AR_HOSTNAME/$_AR_PROJECT_ID/$_AR_REPOSITORY/$REPO_NAME/$_SERVICE_NAME:$COMMIT_SHA",
        "backend",
        "-f", "backend/Dockerfile",
      ]
    },
    {
      id   = "Push"
      name = "gcr.io/cloud-builders/docker"
      args = ["push", "$_AR_HOSTNAME/$_AR_PROJECT_ID/$_AR_REPOSITORY/$REPO_NAME/$_SERVICE_NAME:$COMMIT_SHA"]
    },
    {
      id         = "Deploy"
      name       = "gcr.io/google.com/cloudsdktool/cloud-sdk:slim"
      entrypoint = "gcloud"
      args = [
        "run", "services", "update", "$_SERVICE_NAME",
        "--platform=managed",
        "--image=$_AR_HOSTNAME/$_AR_PROJECT_ID/$_AR_REPOSITORY/$REPO_NAME/$_SERVICE_NAME:$COMMIT_SHA",
        "--labels=managed-by=gcp-cloud-build-deploy-cloud-run,commit-sha=$COMMIT_SHA,gcb-build-id=$BUILD_ID,gcb-trigger-id=$_TRIGGER_ID",
        "--region=$_DEPLOY_REGION",
        "--quiet",
      ]
    },
  ]

  depends_on = [google_project_service.apis, module.cloud_run]
}

module "firebase_hosting" {
  source     = "../../modules/firebase-hosting"
  project_id = var.project_id

  custom_domain     = var.firebase_custom_domain
  github_repository = var.github_repository
  # Binds prod's Firebase deployer SA to dev's EXISTING github-actions WIF pool (shared project)
  # — project_number is used to construct that pool's resource name. wif_pool_id/wif_provider_id
  # default to dev's "github-actions"/"github".
  project_number = var.project_number

  depends_on = [google_project_service.apis]
}
