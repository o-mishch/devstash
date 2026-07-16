# Root module for the `prod` environment: Cloud Run (Go backend, built/deployed by Cloud Build)
# + Firebase Hosting (Vite SPA, deployed by a second, `web/**`-scoped Cloud Build trigger —
# same CI system as the backend; see context/current-feature.md Frontend Track F0). Deliberately
# NOT dev's GKE/Memorystore/
# Cloud SQL shape, and deliberately NOT carrying dev's suspend/resume machinery — this
# environment stays up permanently; Cloud Run's own min-instances=0 already gives scale-to-
# zero cost efficiency.

locals {
  # The two origins, each written down exactly once. Everything that needs "where the SPA
  # lives" or "where the API lives" derives from these — see origin_env below and the web
  # trigger's VITE_* env.
  spa_origin = "https://${var.firebase_custom_domain}"
  api_origin = "https://${var.app_domain}"

  # Non-secret env vars whose value is a derived origin, mapped NAME -> origin. Kept here rather
  # than in var.app_env_vars' default because Terraform forbids variable/local refs in a default;
  # deriving them (not hardcoding) makes the apex cutover a one-variable change instead of
  # silently leaving the backend trusting only `beta.`, which would make CrossOriginProtection
  # 403 every state-changing request from the new origin (a total API outage that fails closed,
  # but fails). Each is load-bearing:
  #   - ALLOWED_ORIGINS  backend CORS allowlist AND CSRF trusted-origin allowlist (config.go)
  #   - SPA_ORIGIN       where the OAuth callback 302s back to
  #   - API_BASE_URL     this service's own origin, used to build the registered OAuth redirect_uri
  origin_env = {
    ALLOWED_ORIGINS = local.spa_origin
    SPA_ORIGIN      = local.spa_origin
    API_BASE_URL    = local.api_origin
  }

  app_env_vars = concat(
    [for name, value in local.origin_env : { name = name, value = value, secret_name = null, secret_version = "latest" }],
    var.app_env_vars,
  )
}

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
  keep_count    = 3
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
  env                 = local.app_env_vars
  domain              = var.app_domain
  deletion_protection = true
  # ON since the 2026-07-13 cutover (var.enable_domain_mapping default flipped to true): maps
  # api.devstash.one -> this us-central1 service. Both preconditions were met — us-central1
  # healthy + the old europe-west1 service/mapping gone (its disappearance had taken
  # api.devstash.one down). Creating this remaps the hostname; Cloud Run then provisions a fresh
  # cert (~15min-few hours), during which api.devstash.one is unavailable.
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

  branch_filter_regex = var.cloudbuild_branch_filter
  # Dedicated least-privilege deploy SA (deployers.tf) — replaces the legacy compute-default SA.
  deployer_service_account = module.backend_deployer.email

  # Scope to the Go tree so a frontend-only (`web/**`) push doesn't rebuild + redeploy the
  # backend. Pairs with the web trigger's `["web/**"]` filter below.
  included_files = ["backend/**"]

  substitutions = {
    _AR_HOSTNAME   = "${var.region}-docker.pkg.dev"
    _AR_PROJECT_ID = var.project_id
    _AR_REPOSITORY = module.artifact_registry.repository_id
    _DEPLOY_REGION = var.region
    _PLATFORM      = "managed"
    _SERVICE_NAME  = module.cloud_run.service_name
    _TRIGGER_ID    = local.cloudbuild_trigger_id
  }

  # No build_images: ko pushes the image itself during the Build step (it doesn't use the local
  # Docker daemon), so Cloud Build's post-build image push has nothing to push. Leave it empty.
  tags = ["gcp-cloud-build-deploy-cloud-run", "gcp-cloud-build-deploy-cloud-run-managed", "devstash"]

  build_steps = [
    {
      # ko replaces the old docker build + push (see backend/.ko.yaml). No Dockerfile, no Docker
      # daemon: ko builds the Go binary and pushes a distroless image straight to Artifact
      # Registry, authenticating to *.pkg.dev via the build SA's ADC. Runs in a golang:1.26 image
      # (matches go.mod; pulled from mirror.gcr.io to dodge Docker Hub's pull cap) and installs ko
      # there so the toolchain is guaranteed to match. --bare pushes to exactly KO_DOCKER_REPO,
      # --tags stamps the commit sha — so the Deploy step below references the same :$COMMIT_SHA.
      id         = "Build"
      name       = "mirror.gcr.io/library/golang:1.26"
      entrypoint = "bash"
      dir        = "backend"
      args = [
        "-c",
        "go install github.com/google/ko@latest && KO_DOCKER_REPO=$_AR_HOSTNAME/$_AR_PROJECT_ID/$_AR_REPOSITORY/$REPO_NAME/$_SERVICE_NAME ko build --bare --tags=$COMMIT_SHA ./cmd/api",
      ]
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

  depends_on = [
    google_project_service.apis,
    module.cloud_run,
    # The deploy SA's roles (incl. logWriter + the CB service-agent token-creator inside the
    # module) + the backend-only resource-scoped grants must exist before the trigger builds.
    module.backend_deployer,
    google_artifact_registry_repository_iam_member.backend_deployer_ar,
    google_service_account_iam_member.backend_deployer_runtime_actas,
  ]
}

module "firebase_hosting" {
  source     = "../../modules/firebase-hosting"
  project_id = var.project_id

  custom_domain = var.firebase_custom_domain

  depends_on = [google_project_service.apis]
}

# Frontend deploy — a second Cloud Build trigger, `web/**`-scoped, that mirrors the backend's
# Cloud Run trigger but builds the Vite SPA and deploys it to Firebase Hosting. Runs as the
# dedicated least-privilege firebase_deployer SA (deployers.tf), not the compute-default SA.
# Modern deploy stack: Node 24 (matches .nvmrc) for the build — pulled from mirror.gcr.io (GCP's
# rate-limit-free Docker Hub mirror) to dodge Docker Hub's Apr-2025 anonymous pull cap — then
# Google's official firebase-cli builder image for the deploy, authenticating via the trigger
# SA's ADC (metadata server), the path Google's Cloud Build -> Firebase guide documents. This
# trigger is CREATED (not imported like the backend one), so trigger_name is a friendly name.
module "web_cloudbuild_trigger" {
  source     = "../../modules/cloudbuild-trigger"
  project_id = var.project_id

  trigger_name     = "devstash-web-firebase-deploy"
  description      = "Build the web/ Vite SPA and deploy to Firebase Hosting on push to \"${var.cloudbuild_branch_filter}\""
  github_owner     = split("/", var.github_repository)[0]
  github_repo_name = split("/", var.github_repository)[1]

  branch_filter_regex      = var.cloudbuild_branch_filter
  deployer_service_account = module.firebase_deployer.email

  # Only fire on frontend changes — pairs with the backend trigger's ["backend/**"].
  included_files = ["web/**"]

  tags = ["devstash", "firebase-hosting", "web"]

  build_steps = [
    {
      id         = "Install"
      name       = "mirror.gcr.io/library/node:24"
      entrypoint = "npm"
      dir        = "web"
      args       = ["ci"]
    },
    {
      # Fail the build on any lint error before spending time on the Vite build.
      # Same self-contained `oxlint .` (type-aware via tsgolint) as web's pre-commit
      # gate and `npm run lint` — no Next, own plugins. Mirrors the backend trigger's
      # golangci-lint discipline.
      id         = "Lint"
      name       = "mirror.gcr.io/library/node:24"
      entrypoint = "npm"
      dir        = "web"
      args       = ["run", "lint"]
    },
    {
      id         = "Build"
      name       = "mirror.gcr.io/library/node:24"
      entrypoint = "npm"
      dir        = "web"
      args       = ["run", "build"]
      # The SPA bakes two absolute origins at build time:
      #   VITE_SITE_URL     — crawler-facing self URLs (canonical, og:url, sitemap, JSON-LD),
      #                       sourced from firebase_custom_domain (where the site is served),
      #                       so it auto-flips at the apex cutover.
      #   VITE_API_BASE_URL — the Cloud Run backend origin the client calls (cross-origin),
      #                       sourced from app_domain, the single source of truth for the API.
      # Both mirror the web code's fallbacks (site-config.ts / lib/api/config.ts); wiring them
      # here keeps the deployed origins driven by the same Terraform vars as the infrastructure.
      # Both reuse the SAME locals as the backend env — VITE_SITE_URL shares local.spa_origin
      # with ALLOWED_ORIGINS/SPA_ORIGIN, and VITE_API_BASE_URL shares local.api_origin with
      # API_BASE_URL — so the SPA's self-URL, the API's own origin, and the API's trust of the
      # SPA cannot drift apart.
      env = [
        "VITE_SITE_URL=${local.spa_origin}",
        "VITE_API_BASE_URL=${local.api_origin}",
      ]
    },
    {
      # Official Firebase CLI builder image; its entrypoint is `firebase`, so no entrypoint
      # override. $PROJECT_ID is a built-in Cloud Build substitution. Runs from web/ where
      # firebase.json + .firebaserc live.
      id   = "Deploy"
      name = "us-docker.pkg.dev/firebase-cli/us/firebase"
      dir  = "web"
      args = ["deploy", "--only=hosting", "--project=$PROJECT_ID"]
    },
  ]

  depends_on = [google_project_service.apis, module.firebase_deployer]
}
