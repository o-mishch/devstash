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
  merged_secrets  = merge(var.app_secrets, local.s3_interop_secrets)
  app_config_json = jsonencode(local.merged_secrets)

  # Content-derived version for the write-only secret_data_wo below. secret_data_wo is not read
  # back from the API and not stored in state, so Terraform can't tell when the blob changed —
  # it only re-writes the version when secret_data_wo_version changes. Deriving that integer from
  # the blob's sha256 makes it auto-bump whenever ANY key changes (including the Terraform-managed
  # HMAC key, which rotates on its own), with no manual bookkeeping. Take 7 hex digits (max
  # ~2.68e8) so the value stays a positive int32 (the provider's type for this field).
  app_config_wo_version = parseint(substr(sha256(local.app_config_json), 0, 7), 16)
}

# ONE consolidated secret holding a JSON object of every APP credential, keyed by the
# same short names the old per-secret suffixes used (auth-secret, database-url, s3-secret,
# …). Consolidated from ~14 individual Secret Manager secrets into a single secret so a
# deep-suspended env stays inside Secret Manager's 6-active-version always-free tier: one
# active version, not 9+. External Secrets Operator splits it back into individual k8s
# Secret keys via remoteRef.property (see infra/k8s/overlays/gcp/external-secrets.yaml).
# The conditional infra keys (database-*/redis-*) are simply absent from the JSON while the
# environment is suspended — the blob is still a single version either way.
#
# Only APP creds live here — the app SA gets secretAccessor on this secret (below), so nothing
# the app never uses belongs in it. OPS-only credentials (the Spaceship DNS API pair that
# the devstash-infra CLI uses on resume) live in a SEPARATE consolidated secret, devstash-ops-config (see
# envs/dev/dns.tf), which the app SA is deliberately NOT granted — least privilege.
resource "google_secret_manager_secret" "app_config" {
  secret_id = "devstash-app-config"

  replication {
    auto {}
  }

  labels = var.labels

  # Outlive a full `devstash-infra gcp down`. Secret Manager is effectively free (2 secrets, single
  # version each — well inside the 6-free-version tier, ~$0/mo), and re-populating the app
  # creds blob by hand after every teardown is the real cost. `down` runs `tofu destroy`
  # with `-exclude` for this address so a normal teardown skips it cleanly; prevent_destroy
  # is the belt-and-suspenders backstop that makes ANY unfiltered destroy ERROR rather than
  # silently take the secrets with it. To intentionally remove it, drop this block first.
  lifecycle {
    prevent_destroy = true
  }
}

# The version holding the JSON blob. WRITE-ONLY + hash-versioned + disable-not-destroy —
# three deliberate choices that fix a production outage the naive `secret_data` form caused:
#
#   1. secret_data_wo (write-only) — the value is NEVER written to Terraform state, and NEVER
#      read back from the API. This is the current best-practice for sensitive values (needs
#      Terraform ≥1.11 + a recent google provider). The plain `secret_data` field, by contrast,
#      is FORCE-NEW: every value change REPLACES the version (destroy-then-create), and the
#      provider default DESTROYS the old version. That left a trail of destroyed versions and —
#      when a replace was interrupted or two applies raced — left the NEWEST version DESTROYED.
#      A destroyed latest is unrecoverable: `gcloud secrets versions access latest` returns
#      FAILED_PRECONDITION, which broke ESO sync, the app pods, AND the auto-suspend `prepare`
#      step (so the cluster ran 24/7). secret_data_wo updates IN PLACE on a version bump — no
#      ForceNew, no version churn, no destroyed-latest.
#   2. secret_data_wo_version = a content-derived hash (see local above). Because the value is
#      write-only, Terraform re-pushes it only when this integer changes; deriving it from the
#      blob's sha256 makes it auto-bump on any real change with zero manual bookkeeping.
#   3. deletion_policy = "DISABLE" — belt-and-suspenders: should a version ever be removed, it is
#      DISABLED, never DESTROYED, so it can't rot into the unrecoverable DESTROYED state.
resource "google_secret_manager_secret_version" "app_config" {
  secret                 = google_secret_manager_secret.app_config.id
  secret_data_wo         = local.app_config_json
  secret_data_wo_version = local.app_config_wo_version
  deletion_policy        = "DISABLE"
}

# Drift detection: assert the version Terraform manages is still ENABLED. This is the
# continuous-validation pattern the google provider documents for catching out-of-band state
# changes (their example asserts a VM is RUNNING). It exists because a real outage was masked
# here: the version-bump is TWO Secret Manager operations (disable old → add new), and a deploy
# that read the secret between them saw ZERO enabled versions, then silently "succeeded" with the
# app broken. This check surfaces the wrong state — a managed version disabled out-of-band, or an
# apply interrupted mid-bump leaving the tracked version disabled — at plan/apply time as a
# warning, instead of at the next deploy as a silent failure. The CI enabled-version gate
# (the devstash-infra CLI's app-config version-bump gate) is the deploy-time counterpart; this is the apply-time one.
#
# We read the SPECIFIC version this resource created (not "latest") — the `latest` data source
# resolves to the newest ENABLED version and would happily return an OLDER enabled one, hiding the
# very drift we want to catch. A `check` block's failed assertion is a non-blocking warning, so
# this never wedges an apply; it only flags the operator.
check "app_config_version_enabled" {
  data "google_secret_manager_secret_version" "app_config" {
    secret  = google_secret_manager_secret.app_config.secret_id
    version = google_secret_manager_secret_version.app_config.version
  }

  assert {
    condition = data.google_secret_manager_secret_version.app_config.enabled
    error_message = format(
      "devstash-app-config version %s is DISABLED — External Secrets can't sync and the app has no credentials. A version-bump apply may have been interrupted (disable-old→add-new), or the version was disabled out-of-band. Re-enable it: gcloud secrets versions enable %s --secret=devstash-app-config, or re-apply to push a fresh enabled version.",
      google_secret_manager_secret_version.app_config.version,
      google_secret_manager_secret_version.app_config.version,
    )
  }
}

# Grant the app SA read access to the one consolidated secret.
resource "google_secret_manager_secret_iam_member" "app_access" {
  secret_id = google_secret_manager_secret.app_config.id
  role      = "roles/secretmanager.secretAccessor"
  member    = "serviceAccount:${google_service_account.app.email}"
}

# --- Memorystore for Valkey IAM auth --------------------------------------
# Valkey uses IAM AUTH instead of a static password: the app authenticates with a
# short-lived OAuth2 access token minted for THIS SA via Workload Identity (see
# src/lib/infra/redis-tcp.ts, gated by REDIS_IAM_AUTH). dbConnectionUser grants the
# memorystore.instances.connect permission the AUTH handshake checks. The role is
# project-scoped (it authorizes connecting to instances in the project); there is no
# per-instance IAM binding for Memorystore.
resource "google_project_iam_member" "app_memorystore_connect" {
  project = var.project_id
  role    = "roles/memorystore.dbConnectionUser"
  member  = "serviceAccount:${google_service_account.app.email}"
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
# ({project_number}-compute@developer.gserviceaccount.com) by default, or a custom
# service account if configured. We grant permissions to both the default SA (to prevent
# breaking any legacy/existing nodes in flight) and the new custom GKE node service
# account.
#
# The default Compute Engine SA email is always
# "{project_number}-compute@developer.gserviceaccount.com". The project number comes from
# var.project_number (passed in statically) rather than a google_project data source, so the
# member string is plan-time known and the bindings never REPLACE on the -refresh=false suspend
# apply (see var.project_number + the local below).
#
# DO NOT remove the compute_default_sa_node binding. Without it, kubectl get nodes returns "No
# resources found" and all system pods stay Pending indefinitely on Autopilot.
locals {
  # Compute Engine default SA — the identity Autopilot nodes run as. Both the node-role
  # binding and the Artifact Registry reader binding below target it, so single-source the
  # member string here. Built from var.project_number (a plan-time-known static input), NOT
  # data.google_project.current.number: under the auto-suspend's `-refresh=false` apply the
  # data source is read-during-apply, so a member derived from it is unknown at plan time and
  # the binding is REPLACED — whose destroy needs setIamPolicy/getIamPolicy the lifecycle SA
  # lacks (403). A static project number keeps these two bindings stable no-ops across suspend.
  compute_default_sa_member = "serviceAccount:${var.project_number}-compute@developer.gserviceaccount.com"
}

resource "google_project_iam_member" "compute_default_sa_node" {
  project = var.project_id
  role    = "roles/container.defaultNodeServiceAccount"
  member  = local.compute_default_sa_member
}

# Custom GKE Node Service Account role bindings.
resource "google_project_iam_member" "gke_node_sa_node" {
  count   = var.gke_node_sa_email != "" ? 1 : 0
  project = var.project_id
  role    = "roles/container.defaultNodeServiceAccount"
  member  = "serviceAccount:${var.gke_node_sa_email}"
}

# Node image-pull access to Artifact Registry.
#
# Both the default compute SA (legacy) and the custom GKE node SA need roles/artifactregistry.reader
# to pull images from Artifact Registry.
#
# Gated on environment_active: these are REPO-SCOPED bindings, and the AR repo itself is
# destroyed on deep-suspend (envs/dev/main.tf), so a binding cannot outlive it — Terraform
# destroys them with the repo in the same `-refresh=false` suspend apply. Unlike the node SA's
# PROJECT-LEVEL bindings (kept always-on to avoid project setIamPolicy on teardown), removing a
# repo-scoped binding needs only artifactregistry.repositories.setIamPolicy on THIS repo, which
# the lifecycle SA holds via the project-scoped lifecycle_ar_deleter role.
#
# DESTROY ORDER — depends_on on the repo resource (var.artifact_registry_repository_depends_on).
# These members target the STATIC repo-id string, NOT the repo resource, so without this edge
# Terraform is free to destroy the repo FIRST; the member destroy then calls getIamPolicy/
# setIamPolicy on a repo that is already gone, which GCP answers with 403 (not 404). That 403
# aborts the whole suspend apply BEFORE it reaches the GKE count→0 destroy, stranding the cluster
# billing — the exact incident this edge fixes. A depends_on is reversed on destroy, so it forces
# every member below to be removed while the repo still exists, then the repo. Value unused (edge
# only) → no plan-time-unknown under -refresh=false.
resource "google_artifact_registry_repository_iam_member" "node_artifact_registry_reader" {
  count      = var.environment_active ? 1 : 0
  project    = var.project_id
  location   = var.region
  repository = var.artifact_registry_repository_id
  role       = "roles/artifactregistry.reader"
  member     = local.compute_default_sa_member

  depends_on = [var.artifact_registry_repository_depends_on]
}

resource "google_artifact_registry_repository_iam_member" "custom_node_artifact_registry_reader" {
  count      = var.environment_active && var.gke_node_sa_email != "" ? 1 : 0
  project    = var.project_id
  location   = var.region
  repository = var.artifact_registry_repository_id
  role       = "roles/artifactregistry.reader"
  member     = "serviceAccount:${var.gke_node_sa_email}"

  depends_on = [var.artifact_registry_repository_depends_on]
}

# --- CI/CD deployer service account ---------------------------------------
# The GitHub Actions / Cloud Build identity: push images + deploy to GKE.
# In CI we authenticate this via Workload Identity Federation (no key) — see
# infra/docs/04-cicd.md.
resource "google_service_account" "deployer" {
  account_id   = "devstash-deployer"
  display_name = "DevStash CI/CD deployer"
}

# Scope image push AND post-deploy prune to this repository. repoAdmin (not writer) because
# the deploy pipeline's final step (devstash-infra ci prune-registry) deletes superseded image
# versions the moment a rollout is healthy — an immediate equivalent of the repository's
# keep_count=1 cleanup policy, which otherwise only runs on Artifact Registry's ~daily async
# sweep. deleteArtifacts lives in repoAdmin; scope it to THIS repo only (not project-wide
# artifactregistry.admin) — the same repo-scoped-grant posture as the node reader above and
# the lifecycle purge SA in envs/dev/auto-suspend.tf. The repository is created by a sibling
# root module and passed in as an input; that dependency is acyclic and is preferable to a
# project-wide grant.
resource "google_artifact_registry_repository_iam_member" "deployer_artifact_registry" {
  # Gated on environment_active for the same reason as the node readers above: repo-scoped, so it
  # is destroyed with the repo on suspend. The deployer SA does not run the suspend build (that's
  # the lifecycle SA); on resume this binding is recreated before CI pushes the first image.
  count      = var.environment_active ? 1 : 0
  project    = var.project_id
  location   = var.region
  repository = var.artifact_registry_repository_id
  role       = "roles/artifactregistry.repoAdmin"
  member     = "serviceAccount:${google_service_account.deployer.email}"

  # See node_artifact_registry_reader — same destroy-order edge so this member is removed while
  # the repo still exists (else its setIamPolicy 403s on the vanished repo and aborts suspend).
  depends_on = [var.artifact_registry_repository_depends_on]
}

# --- Binary Authorization signing + vulnerability-gate read access ---------------
# Lets CI (the deployer SA) sign an attestation for each deployed digest
# (`gcloud container binauthz attestations sign-and-create`, see deploy-gke.yml) and
# read Artifact Analysis vulnerability findings for the CI vulnerability gate. Both
# are scoped to the single key/note this module is handed — not project-wide KMS or
# Container Analysis access — mirroring the repo-scoped Artifact Registry grant above.
# Gated with the pipeline: crypto_key_id / note are null when binauthz is disabled, so
# these two grants must not be created then. The project-level viewer roles below stay
# ungated — they are free, depend on no gated resource, and keep the CI vulnerability
# gate working independently of the signing pipeline.
resource "google_kms_crypto_key_iam_member" "deployer_binauthz_signer" {
  count         = var.binauthz_enabled ? 1 : 0
  crypto_key_id = var.binauthz_kms_crypto_key_id
  role          = "roles/cloudkms.signerVerifier"
  member        = "serviceAccount:${google_service_account.deployer.email}"
}

resource "google_container_analysis_note_iam_member" "deployer_binauthz_attacher" {
  count   = var.binauthz_enabled ? 1 : 0
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

# secretmanager.viewer lets the deploy job's app-config version-bump gate (in the devstash-infra
# CLI) list devstash-app-config's versions and see their ENABLED/DISABLED
# state — it never reads secret payloads (that's ESO's job via the app SA's secretAccessor
# above). Without this, ds_newest_enabled_secret_version's `gcloud secrets versions list` 403s
# for the deployer SA; the helper tolerates the error by returning empty (indistinguishable from
# "genuinely no enabled version"), so the gate exhausted its full poll window and failed even
# with a valid enabled version already live — confirmed live 2026-07-06 (run 28813891695).
resource "google_project_iam_member" "deployer_secret_viewer" {
  project = var.project_id
  role    = "roles/secretmanager.viewer"
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

# --- Lifecycle-deployer service account: on-demand resume / suspend from GitHub UI ---
# The identity for the MANUAL, GitHub-Actions-driven suspend/resume button
# (.github/workflows/infra-lifecycle.yml → devstash-infra gcp resume|suspend).
# Distinct from `deployer` because a FULL `tofu apply` — recreating GKE, Memorystore,
# Cloud NAT/Armor, Cloud SQL, and the repo-scoped AR IAM members — needs far broader
# rights than `deployer`'s deploy-only container.admin. Distinct from the auto-suspend
# `lifecycle` SA (envs/dev/auto-suspend.tf) because that one is a Cloud Build identity
# scoped to the unattended deep-suspend; this one is the GitHub-Actions federated
# identity for the operator-triggered button. The two intentionally hold the SAME role
# posture (see lifecycle_deployer_roles below) so the manual and unattended paths have
# identical blast radius.
resource "google_service_account" "lifecycle_deployer" {
  account_id   = "devstash-lifecycle-deployer"
  display_name = "DevStash on-demand suspend/resume (GitHub Actions)"
}

locals {
  # Mirror of the auto-suspend `lifecycle` SA's role set (envs/dev/auto-suspend.tf
  # lifecycle_roles) — the full suspend/resume apply touches the same GCP surface, so
  # the two identities carry the same broad-but-bounded roles. DELIBERATELY OMITS
  # roles/resourcemanager.projectIamAdmin: this SA must NOT be able to rewrite project
  # IAM (the escalation the whole least-privilege split exists to avoid). Consequence,
  # accepted by design: project-IAM state must already be converged (committed main ==
  # state) before the button is clicked, so the refresh-only apply finds zero project-IAM
  # diff to write — the SAME operator-converges-first rule that governs auto-suspend
  # (see the extended note in auto-suspend.tf).
  #
  # NOTE on the two project-level ADMIN roles below (storage.admin, artifactregistry.admin):
  # the auto-suspend SA reaches these same surfaces with narrow, resource-scoped CUSTOM roles
  # (auto-suspend.tf lifecycle_ar_deleter, lifecycle_db_dumps_iam, lifecycle_staging_deleter,
  # plus bucket-scoped lifecycle_state / lifecycle_db_dumps members) precisely because it runs
  # UNATTENDED on every idle tick — there, minimising standing blast radius is worth the extra
  # custom-role machinery. This SA is the OPERATOR-triggered button (WIF-fenced to a main-ref
  # dispatch, only you can fire it), so it takes the two predefined admin roles instead: fewer
  # moving parts, and the marginal blast radius over the custom roles is bounded to storage +
  # Artifact Registry, not project IAM. Revisit if this identity ever becomes non-interactive.
  lifecycle_deployer_roles = [
    "roles/container.admin",
    "roles/memorystore.admin",
    "roles/compute.networkAdmin",
    "roles/compute.securityAdmin",
    "roles/cloudsql.admin",
    "roles/secretmanager.secretVersionManager",
    "roles/secretmanager.secretAccessor",
    "roles/secretmanager.viewer",
    "roles/monitoring.viewer",
    "roles/browser",
    "roles/cloudkms.viewer",
    "roles/logging.logWriter",
    "roles/cloudbuild.builds.editor",
    "roles/serviceusage.serviceUsageConsumer",
    # storage.admin: the resume apply reads/writes the tofu STATE bucket and the DB-dumps
    # bucket (restore_db imports the GCS dump), and the suspend cleanup deletes the
    # _cloudbuild staging bucket. Covers all three (get/create/delete + object + setIamPolicy).
    "roles/storage.admin",
    # artifactregistry.admin: the resume apply RECREATES the Artifact Registry repo AND its
    # repo-scoped IAM members (google_artifact_registry_repository_iam_member — deployer
    # repoAdmin + node readers), and suspend DESTROYS them. That needs repositories.{create,
    # delete,get,getIamPolicy,setIamPolicy} — NOT covered by container.admin (which is GKE).
    # The auto-suspend SA gets exactly these via the lifecycle_ar_deleter custom role; this
    # SA takes the predefined admin per the operator-convenience note above.
    "roles/artifactregistry.admin",
  ]
}

resource "google_project_iam_member" "lifecycle_deployer" {
  for_each = toset(local.lifecycle_deployer_roles)
  project  = var.project_id
  role     = each.value
  member   = "serviceAccount:${google_service_account.lifecycle_deployer.email}"
}

# Same WIF pool/provider as the deployer above — so the SAME attribute_condition
# (repo + owner-id + refs/heads/main + ref_type==branch) fences this identity too. Only
# a workflow_dispatch on `main` of THIS repo can exchange a token and impersonate this SA.
resource "google_service_account_iam_member" "lifecycle_deployer_github_wif" {
  service_account_id = google_service_account.lifecycle_deployer.name
  role               = "roles/iam.workloadIdentityUser"
  member             = "principalSet://iam.googleapis.com/${google_iam_workload_identity_pool.github.name}/attribute.repository/${var.github_repository}"
}
