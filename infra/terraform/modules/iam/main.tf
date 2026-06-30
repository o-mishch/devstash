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
# Merge the caller-supplied secrets with the GCS S3-interop HMAC credentials minted
# here (the HMAC key depends on the app SA this module owns, so it can't be
# threaded in via var.app_secrets without a cycle). The `secret` is sensitive;
# `merged_secrets` is therefore sensitive and only referenced inside resource
# bodies, never as a for_each key.
#
# AWS_ENDPOINT_URL_S3 ("https://storage.googleapis.com") and AWS_REGION ("auto" — the
# region string Google officially requires for GCS S3-interop, see cloud.google.com/
# storage/docs/aws-simple-migration; GCS ignores the SigV4 region, the SDK just needs a
# non-empty value) are NOT secrets — they are fixed, environment-independent constants —
# so they live as plain ConfigMap literals (infra/k8s/overlays/gcp/kustomization.yaml)
# instead of Secret Manager. Only the actual HMAC credential pair stays here.
locals {
  s3_interop_secrets = {
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

# Node image-pull access to Artifact Registry.
#
# DO NOT remove this binding. Autopilot nodes run as the Compute Engine default SA
# (above) and the kubelet uses THAT SA to fetch a pull token from Artifact Registry.
# roles/container.defaultNodeServiceAccount grants node registration + logging/monitoring
# but ZERO Artifact Registry permissions, and this project enforces the
# iam.automaticIamGrantsForDefaultServiceAccounts org-policy constraint (so the default SA
# starts with no roles at all — the same reason the node-role grant above is explicit).
# Without artifactregistry.reader the kubelet's token request returns 403 and every
# AR-hosted image (migrate, web) lands in ImagePullBackOff. System charts pulled from
# Docker Hub/quay are unaffected — they need no GCP auth — so the tell is "only the
# in-project AR images fail to pull" (e.g. the migrate Job hangs ImagePullBackOff while
# external-secrets/reloader start fine).
#
# Scoped to THIS repository (least privilege), mirroring the deployer's writer grant
# below — not a project-wide roles/artifactregistry.reader. Both the node SA (read) and
# the deployer SA (write) are bound on the same repository resource.
# Ref: Google "Troubleshoot image pulls" — grant the node SA roles/artifactregistry.reader
# so GKE can pull images from Artifact Registry repositories in the same project.
resource "google_artifact_registry_repository_iam_member" "node_artifact_registry_reader" {
  project    = var.project_id
  location   = var.region
  repository = var.artifact_registry_repository_id
  role       = "roles/artifactregistry.reader"
  member     = "serviceAccount:${data.google_project.current.number}-compute@developer.gserviceaccount.com"
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

# --- Binary Authorization signing + vulnerability-gate read access ---------------
# Lets CI (the deployer SA) sign an attestation for each deployed digest
# (`gcloud container binauthz attestations sign-and-create`, see deploy-gke.yml) and
# read Artifact Analysis vulnerability findings for the CI vulnerability gate. Both
# are scoped to the single key/note this module is handed — not project-wide KMS or
# Container Analysis access — mirroring the repo-scoped Artifact Registry grant above.
resource "google_kms_crypto_key_iam_member" "deployer_binauthz_signer" {
  crypto_key_id = var.binauthz_kms_crypto_key_id
  role          = "roles/cloudkms.signerVerifier"
  member        = "serviceAccount:${google_service_account.deployer.email}"
}

resource "google_container_analysis_note_iam_member" "deployer_binauthz_attacher" {
  project = var.project_id
  note    = var.binauthz_note_id
  role    = "roles/containeranalysis.notes.attacher"
  member  = "serviceAccount:${google_service_account.deployer.email}"
}

# Attestor metadata is read-only project-level lookup (binaryauthorization.attestors.get);
# Binary Authorization has no per-attestor IAM resource to scope this to.
resource "google_project_iam_member" "deployer_binauthz_viewer" {
  project = var.project_id
  role    = "roles/binaryauthorization.attestorsViewer"
  member  = "serviceAccount:${google_service_account.deployer.email}"
}

# Vulnerability findings (Artifact Analysis occurrences) are project-level Container
# Analysis resources, not sub-resources of the Artifact Registry repository — there is
# no narrower IAM scope than the project for read access to them.
resource "google_project_iam_member" "deployer_vulnerability_viewer" {
  project = var.project_id
  role    = "roles/containeranalysis.occurrences.viewer"
  member  = "serviceAccount:${google_service_account.deployer.email}"
}

# GKE IAM roles can only be granted on the project, not directly on a cluster
# (`google_container_cluster_iam_member` is not a Google provider resource).
#
# ── TWO settled decisions, both verified in CI — do NOT relitigate ─────────────
#
# (1) NO IAM Condition on this binding.
# An earlier version scoped this with an IAM Condition pinning resource.name to the
# cluster path (projects/<p>/locations/<r>/clusters/<name>). That BROKE DNS-endpoint
# access: a client reaching the control plane over the *.gke.goog DNS endpoint has
# container.clusters.connect evaluated against the DNS-endpoint resource, not the
# cluster-path resource — so the condition never matched and the Google Front End
# returned a GENERIC HTML "403 (Forbidden)" page (not a named-permission error).
# Removing the condition (commit a051ad7) fixed it — VERIFIED: CI then reached the
# first helm/kubectl call. DO NOT re-add a cluster-resource-name condition here.
#
# (2) Role is roles/container.admin — NOT developer, and NOT clusterAdmin.
# Installing system Helm charts (external-secrets, reloader) creates/patches
# cluster-scoped RBAC (ClusterRole, ClusterRoleBinding), namespaced RBAC (Role,
# RoleBinding) and ValidatingWebhookConfiguration. Checked against the live role
# definitions (`gcloud iam roles describe`):
#   - container.developer   → RBAC objects: get/list ONLY (no create/update) → 403
#   - container.clusterAdmin → cluster LIFECYCLE only; ZERO in-cluster RBAC verbs → 403
#   - container.admin        → has container.{clusterRoles,clusterRoleBindings,roles,
#                              roleBindings,validatingWebhookConfigurations}.{create,update,
#                              delete} (+ customResourceDefinitions) → chart install succeeds
# container.admin is the NARROWEST PREDEFINED role that manages in-cluster RBAC.
# DO NOT "downgrade to clusterAdmin for least privilege" — it lacks the RBAC verbs and
# silently re-breaks the external-secrets step. The only tighter option is a custom role
# with exactly those verbs; not worth the maintenance for this dedicated, WIF-scoped SA.
#
# This SA is dedicated to one repo's deploys (WIF-restricted to refs/heads/main of the
# single repo, see below), so project-level container.admin is an acceptable scope.
resource "google_project_iam_member" "deployer_gke" {
  project = var.project_id
  role    = "roles/container.admin"
  member  = "serviceAccount:${google_service_account.deployer.email}"
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
