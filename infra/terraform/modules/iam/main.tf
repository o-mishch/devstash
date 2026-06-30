# IAM + Workload Identity + Secret Manager.
#
# The app pod runs as a Kubernetes ServiceAccount that impersonates this Google
# ServiceAccount (Workload Identity). The Google SA holds least-privilege IAM
# roles (read its secrets, use the bucket). No JSON key is ever exported.

# --- Google service account the app runs as -------------------------------
resource "google_service_account" "app" {
  account_id   = "devstash-app"
  display_name = "DevStash application (Workload Identity)"
}

# --- Workload Identity binding: K8s SA  ->  Google SA ---------------------
# Lets the Kubernetes SA (namespace/name) act as this Google SA.
resource "google_service_account_iam_member" "workload_identity" {
  service_account_id = google_service_account.app.name
  role               = "roles/iam.workloadIdentityUser"
  member             = "serviceAccount:${var.project_id}.svc.id.goog[${var.k8s_namespace}/${var.k8s_service_account}]"
}

# --- App secrets in Secret Manager ----------------------------------------
# One secret per sensitive value. The app reads them at runtime (via External
# Secrets Operator, see infra/k8s/overlays/gcp/external-secrets.yaml) by the
# identity above — they are NOT baked into the image or a plaintext K8s Secret.
#
# Merge the caller-supplied secrets with the GCS S3-interop credentials minted
# here (the HMAC key depends on the app SA this module owns, so it can't be
# threaded in via var.app_secrets without a cycle). The `secret` is sensitive;
# `merged_secrets` is therefore sensitive and only referenced inside resource
# bodies, never as a for_each key.
locals {
  s3_interop_secrets = {
    s3-endpoint  = "https://storage.googleapis.com"
    # "auto" is the region string Google officially requires for GCS S3-interop — used
    # in all language examples in the GCS migration docs (cloud.google.com/storage/docs/
    # aws-simple-migration). GCS ignores the region in the SigV4 signature; the SDK
    # needs *some* non-empty value and "auto" is the documented sentinel. Do NOT change
    # this to a GCP region ("us-central1") or an AWS region ("us-east-1") — neither is
    # accepted. The bucket location is determined by the GCS bucket itself, not this value.
    s3-region    = "auto"
    s3-access-id = google_storage_hmac_key.uploads.access_id
    s3-secret    = google_storage_hmac_key.uploads.secret
  }
  merged_secrets = merge(var.app_secrets, local.s3_interop_secrets)
  # Stable, non-sensitive key list for for_each (values stay out of addresses).
  # keys() inherits sensitive taint from var.app_secrets in Terraform 1.x, so we
  # explicitly strip it — the key *names* (e.g. "database-url") are not secret.
  secret_keys = toset(concat(nonsensitive(keys(var.app_secrets)), keys(local.s3_interop_secrets)))
}

# Iterate over the (non-sensitive) KEY NAMES, not the map itself — the secret
# values are sensitive and can't be used as for_each keys (they'd leak into
# resource addresses). Look the value up by key inside the body instead.
resource "google_secret_manager_secret" "secrets" {
  for_each  = local.secret_keys
  secret_id = "devstash-${each.key}"

  replication {
    auto {}
  }

  labels = var.labels
}

resource "google_secret_manager_secret_version" "versions" {
  for_each    = local.secret_keys
  secret      = google_secret_manager_secret.secrets[each.key].id
  secret_data = local.merged_secrets[each.key]
}

# Grant the app SA read access to its secrets.
resource "google_secret_manager_secret_iam_member" "app_access" {
  for_each  = google_secret_manager_secret.secrets
  secret_id = each.value.id
  role      = "roles/secretmanager.secretAccessor"
  member    = "serviceAccount:${google_service_account.app.email}"
}

# --- Bucket access ----------------------------------------------------------
# The application calls DeleteObject when a file/image item or orphaned upload is
# removed. objectCreator + objectViewer is therefore insufficient: deletes fail with
# 403 and leave billable orphaned objects. objectUser is the narrow predefined role
# that supplies create/get/list/delete without bucket-administration permissions.
# Do not reduce this back to creator+viewer unless deleteFromS3 is removed as well.
resource "google_storage_bucket_iam_member" "bucket_objects" {
  bucket = var.uploads_bucket_name
  role   = "roles/storage.objectUser"
  member = "serviceAccount:${google_service_account.app.email}"
}

# --- GCS S3-interoperability HMAC key for the app SA ----------------------
# The app keeps using the AWS S3 SDK pointed at GCS's S3-interop endpoint
# (https://storage.googleapis.com). That endpoint authenticates with HMAC keys,
# not Google OAuth — so we mint one bound to the app SA. access_id/secret become
# AWS_ACCESS_KEY_ID / AWS_SECRET_ACCESS_KEY (the `secret` is sensitive and stays
# in Secret Manager, never in plan output). See src/lib/storage/s3-local.ts —
# the SDK auto-enables path-style when AWS_ENDPOINT_URL_S3 is the GCS host.
resource "google_storage_hmac_key" "uploads" {
  service_account_email = google_service_account.app.email
}

# --- GKE Autopilot node service account IAM ------------------------------
# Autopilot manages its own node pool using the project's Compute Engine default SA
# ({project_number}-compute@developer.gserviceaccount.com). Without
# roles/container.defaultNodeServiceAccount on that SA, nodes boot, fail to register
# with the cluster, and are immediately deleted by Autopilot — causing the cluster to
# appear empty despite pods being pending. This is separate from the app SA above.
#
# WHY a data source: the default Compute Engine SA email is always
# "{project_number}-compute@developer.gserviceaccount.com". We cannot derive the
# project number from project_id (a name, not a number) without a lookup. The
# google_project data source gives us the number without any additional inputs.
#
# DO NOT remove this binding. Without it, kubectl get nodes returns "No resources found"
# and all system pods stay Pending indefinitely on Autopilot.
data "google_project" "current" {
  project_id = var.project_id
}

resource "google_project_iam_member" "compute_default_sa_node" {
  project = var.project_id
  role    = "roles/container.defaultNodeServiceAccount"
  member  = "serviceAccount:${data.google_project.current.number}-compute@developer.gserviceaccount.com"
}

# --- CI/CD deployer service account ---------------------------------------
# The GitHub Actions / Cloud Build identity: push images + deploy to GKE.
# In CI we authenticate this via Workload Identity Federation (no key) — see
# infra/docs/04-cicd.md.
resource "google_service_account" "deployer" {
  account_id   = "devstash-deployer"
  display_name = "DevStash CI/CD deployer"
}

# Scope image pushes to this repository. The repository is created by a sibling root
# module and passed in as an input; that dependency is acyclic and is preferable to a
# project-wide artifactregistry.writer grant.
resource "google_artifact_registry_repository_iam_member" "deployer_artifact_registry" {
  project    = var.project_id
  location   = var.region
  repository = var.artifact_registry_repository_id
  role       = "roles/artifactregistry.writer"
  member     = "serviceAccount:${google_service_account.deployer.email}"
}

# GKE IAM roles can only be granted on the project, not directly on a cluster
# (`google_container_cluster_iam_member` is not a Google provider resource). Restrict
# the project binding with an IAM Condition over the supported Cluster resource type.
# Keep the full resource name aligned with modules/gke/main.tf; a mismatch prevents CI
# from obtaining credentials or using the Kubernetes API.
resource "google_project_iam_member" "deployer_gke" {
  project = var.project_id
  role    = "roles/container.developer"
  member  = "serviceAccount:${google_service_account.deployer.email}"

  condition {
    title       = "devstash_cluster_only"
    description = "Limit the CI deployer to the DevStash GKE cluster."
    expression  = "resource.type == 'container.googleapis.com/Cluster' && resource.name == 'projects/${var.project_id}/locations/${var.region}/clusters/${var.gke_cluster_name}'"
  }
}

# --- Workload Identity Federation: GitHub Actions OIDC -> deployer SA -------
# GitHub's OIDC token is exchanged for short-lived GCP credentials — NO exported
# JSON key. `terraform output wif_provider` feeds the WORKLOAD_IDENTITY_PROVIDER
# GitHub secret consumed by google-github-actions/auth in deploy-gke.yml.
resource "google_iam_workload_identity_pool" "github" {
  workload_identity_pool_id = "github-actions"
  display_name              = "GitHub Actions"
  description               = "OIDC federation for the DevStash CI/CD pipeline"
}

resource "google_iam_workload_identity_pool_provider" "github" {
  workload_identity_pool_id          = google_iam_workload_identity_pool.github.workload_identity_pool_id
  workload_identity_pool_provider_id = "github"
  display_name                       = "GitHub Actions provider"

  # OIDC issuer for GitHub Actions tokens. (The newer `github_actions {}` block
  # also works on provider >= 6.20, but plain `oidc {}` is supported on every 6.x
  # and is the canonical form for GitHub federation.)
  oidc {
    issuer_uri = "https://token.actions.githubusercontent.com"
  }

  attribute_mapping = {
    "google.subject"       = "assertion.sub"
    "attribute.repository" = "assertion.repository"
    "attribute.ref"        = "assertion.ref"
  }

  # SECURITY: two-layer enforcement (both layers are required; neither alone is sufficient).
  # Layer 1 — attribute_condition (evaluated at OIDC token exchange in GCP STS):
  #   - repository_owner_id: a NUMERIC ID GitHub never reuses (unlike org/repo
  #     names, which can be hijacked after org rename or deletion). Google Cloud
  #     best practice explicitly recommends system-generated IDs over names here.
  #   - attribute.repository: the full "owner/repo" string as a second factor.
  #   - assertion.ref == "refs/heads/main": only push/dispatch events on main can
  #     exchange tokens — feature branches and PRs cannot authenticate to GCP at all.
  #   - assertion.ref_type == "branch": prevents tags named "main" from matching.
  # Layer 2 — principalSet on the IAM binding (google_service_account_iam_member below):
  #   - Further restricts which identities in the pool can impersonate the deployer SA.
  #   - Scoped to attribute.repository (not the whole pool) as belt-and-suspenders.
  # The branch guard lives exclusively in attribute_condition (not the principalSet),
  # which is correct — attribute_condition is enforced before any token is issued.
  #
  # DO NOT relax `assertion.ref == "refs/heads/main"` to a prefix match or remove it
  # entirely — doing so would allow any branch in the repo to authenticate to GCP
  # and trigger a production deploy. The workflow_dispatch event on non-main branches
  # failing at GCP auth is the INTENDED security posture, not a bug.
  #
  # DO NOT switch to `attribute.repository` alone in the principalSet binding without
  # keeping the attribute_condition — the condition is the gate at token-exchange time;
  # the binding is only the IAM authorization layer. Both together = defense-in-depth.
  attribute_condition = <<-EOT
    assertion.repository_owner_id == "${var.github_owner_id}" &&
    attribute.repository == "${var.github_repository}" &&
    assertion.ref == "refs/heads/main" &&
    assertion.ref_type == "branch"
  EOT
}

# Bind the deployer SA to ONLY this repo's federated identities (principalSet
# scoped by attribute.repository). The branch restriction is in attribute_condition
# above (token exchange layer), not here — this binding is the IAM authorization
# layer and both together form defense-in-depth.
resource "google_service_account_iam_member" "github_wif" {
  service_account_id = google_service_account.deployer.name
  role               = "roles/iam.workloadIdentityUser"
  member             = "principalSet://iam.googleapis.com/${google_iam_workload_identity_pool.github.name}/attribute.repository/${var.github_repository}"
}
