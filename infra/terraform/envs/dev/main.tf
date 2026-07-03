# Root module for the `dev` environment. Wires the building-block modules together.
# Dependency order is expressed through input references + explicit depends_on where
# private networking must exist first.

# Enable the GCP APIs this stack needs (idempotent).
resource "google_project_service" "apis" {
  for_each = toset([
    "compute.googleapis.com",
    "container.googleapis.com",
    "memorystore.googleapis.com",       # Memorystore for Valkey (google_memorystore_instance)
    "sqladmin.googleapis.com",          # Cloud SQL
    "servicenetworking.googleapis.com", # VPC peering for Cloud SQL + Memorystore private IP
    "secretmanager.googleapis.com",
    "artifactregistry.googleapis.com",
    "containeranalysis.googleapis.com",   # Artifact Registry vulnerability scan results API
    "iam.googleapis.com",                 # Workload Identity Federation pool/provider
    "iamcredentials.googleapis.com",      # SA impersonation via federated tokens
    "sts.googleapis.com",                 # OIDC -> short-lived GCP token exchange
    "binaryauthorization.googleapis.com", # Binary Authorization cluster enforcement
    "cloudkms.googleapis.com",            # KMS signing key for the Binary Authorization attestor
    "billingbudgets.googleapis.com",      # Cloud Billing budget + threshold alerts (budget.tf)
    # The v1 resource (google_project_organization_policy) uses
    # cloudresourcemanager.googleapis.com, NOT orgpolicy.googleapis.com.
    # cloudresourcemanager.googleapis.com is enabled by default in most projects;
    # it is listed here explicitly so bootstrap re-runs remain safe.
    "cloudresourcemanager.googleapis.com",
    # orgpolicy.googleapis.com is required if the v2 resource (google_org_policy_policy)
    # is ever used. We currently use v1 (see below) due to provider bug #18281, but keep
    # this enabled so switching to v2 doesn't require a separate API-enable step.
    "orgpolicy.googleapis.com",
    "cloudquotas.googleapis.com", # Cloud Quotas API — codifies the SSD_TOTAL_GB increase (quotas.tf)
  ])
  service            = each.value
  disable_on_destroy = false
}

# GCP API enablement is eventually consistent: google_project_service returns as soon as the
# enable operation completes, but a freshly-enabled control plane can still 403 with
# SERVICE_DISABLED for a few minutes afterward ("wait a few minutes for the action to
# propagate to our systems and retry"). A plain depends_on cannot wait this out — we hit it
# on the Memorystore/Valkey instance when adopting the API mid-life via `run.sh apply` (the
# bootstrap pre-enable only runs on `up`/`bootstrap`). Bridge the gap with a one-time,
# create-only sleep so API-consuming resources (the Valkey instance) only build once the API
# is actually usable. No-op on later applies (create-only, no triggers → never re-runs).
resource "time_sleep" "api_propagation" {
  depends_on      = [google_project_service.apis]
  create_duration = "120s"
}

# The org-level `constraints/iam.disableServiceAccountKeyCreation` (enforced by
# default on orgs created after 2024-05-03) blocks google_storage_hmac_key: GCP
# treats HMAC keys as SA credentials subject to this constraint. Override it at the
# project level so Terraform can mint the GCS S3-interop HMAC key for the app SA.
# This override is scoped to this project only; the org-level enforce:true remains.
#
# RESOURCE CHOICE — v1 (google_project_organization_policy) vs v2 (google_org_policy_policy):
#   v2 is the recommended resource (uses Org Policy API v2, supports tags/conditions).
#   However, v2 calls orgpolicy.googleapis.com without the X-Goog-User-Project header
#   when authenticated as authorized_user ADC (not a SA), causing 403 SERVICE_DISABLED
#   even when the API is enabled and quota_project_id is set in ~/.config/gcloud/
#   application_default_credentials.json — confirmed provider bug #18281.
#   v1 calls cloudresourcemanager.googleapis.com, which correctly respects user ADC.
#   Switch to v2 once #18281 is fixed (or when CI/CD authenticates as a SA, not user).
#
# PROPAGATION — GCP org policy changes can take several minutes to propagate.
#   The depends_on below ensures Terraform applies the override BEFORE the HMAC key,
#   but does NOT add a wall-clock delay. On the first apply, if propagation hasn't
#   completed, module.iam.google_storage_hmac_key.uploads will fail with
#   "Request violates constraint ... conditionNotMet". Re-running `tofu apply` a few
#   minutes later always succeeds (the constraint check is idempotent).
#   If this becomes disruptive, add a `time_sleep` resource (hashicorp/time provider)
#   with create_duration = "120s" between this resource and the iam module.
#
# REQUIRED IAM — roles/orgpolicy.policyAdmin at the ORG level (not project) for the
#   Terraform principal. Granting at project level is rejected by GCP with INVALID_ARGUMENT.
#   See 08-gcp-bootstrap.md §3.
resource "google_project_organization_policy" "allow_sa_key_creation" {
  project    = var.project_id
  constraint = "iam.disableServiceAccountKeyCreation"

  boolean_policy {
    enforced = false
  }

  depends_on = [google_project_service.apis]
}

module "network" {
  source      = "../../modules/network"
  name_prefix = local.name_prefix
  region      = var.region
  waf_preview = var.armor_waf_preview
  # Cost toggle: skip Cloud Armor entirely in dev (default false). ~$5/mo policy +
  # per-rule + per-request — a gke.* showcase needs no edge WAF. Prod sets it true.
  armor_enabled = var.armor_enabled
  # Cost toggle: release the ingress IP + tear down NAT/router/Cloud Armor when
  # suspended. The VPC/subnet/PSA peering stay (free; the stopped Cloud SQL needs them).
  compute_active = var.environment_active
  depends_on     = [google_project_service.apis]
}

module "artifact_registry" {
  source     = "../../modules/artifact-registry"
  region     = var.region
  labels     = local.common_labels
  depends_on = [google_project_service.apis]
}

module "gcs" {
  source      = "../../modules/gcs"
  name_prefix = local.name_prefix
  project_id  = var.project_id
  # GCS Always Free applies only in us-west1, us-central1, and us-east1 (aggregate
  # 5 GB-month quota), not every US region or the "US" multi-region. This shared
  # region variable defaults to us-central1 and must remain eligible if cost matters.
  location = var.region
  # Lock browser CORS to origins that send presigned-POST/PUT uploads to this bucket.
  # The GKE frontend (https://<app_domain>) is the primary upload origin. The Vercel
  # production frontend (www.devstash.one) talks to its own S3 bucket and does NOT
  # upload to this GCS bucket — so it is intentionally absent here. If the two
  # deployments are ever unified, add "https://www.devstash.one" to this list.
  cors_origins = ["https://${var.app_domain}", "http://localhost:3000"]
  labels       = local.common_labels
  depends_on   = [google_project_service.apis]
}

module "gke" {
  source              = "../../modules/gke"
  name_prefix         = local.name_prefix
  project_id          = var.project_id
  region              = var.region
  network_self_link   = module.network.network_self_link
  subnet_self_link    = module.network.subnet_self_link
  pods_range_name     = module.network.pods_range_name
  services_range_name = module.network.services_range_name
  labels              = local.common_labels
  # Cost toggle: destroy the cluster when the environment is suspended.
  cluster_active = var.environment_active
  # Supply-chain toggle: provision the Binary Authorization signing pipeline (KMS key,
  # attestor, note, policy, cluster enforcement). Default false in dev — KMS has no free
  # tier, so the always-on signing key is the only standing resource that can never round
  # to $0. Set binauthz_enabled = true in prod for enforcement parity.
  binauthz_enabled = var.binauthz_enabled
  # Observability cost toggle: false (dev default) trims Cloud Ops telemetry to non-chargeable
  # SYSTEM_COMPONENTS only (Managed Prometheus + Advanced Datapath metrics + WORKLOADS logs
  # off). GKE system metrics are free, so this is the one cost-positive cluster knob while up;
  # it never touches the idle auto-suspend alert (a Cloud LB metric). Set true in prod for parity.
  full_observability = var.full_observability
  # The cluster is DELIBERATELY unprotected. It holds no persistent state and is
  # destroyed/recreated on every suspend/resume; a count→0 destroy reads
  # deletion_protection from prior state, so a protected cluster could not be suspended in
  # a single apply. Data safety is provided by the verified GCS dump taken before every
  # deep suspend (Cloud SQL is now torn down too — see the cloudsql module + db-dumps.tf),
  # not by the cluster.
  deletion_protection = false
  # Autopilot: no node_machine_type / min_nodes / max_nodes — Google manages nodes.
  # Pod resources are controlled via K8s resource requests in the Deployment.
  #
  # Explicit (not just transitive via module.network): this module also creates the
  # Binary Authorization KMS keyring directly, which needs cloudkms.googleapis.com
  # enabled before it — don't rely solely on the module.network reference above to
  # imply that ordering.
  depends_on = [google_project_service.apis]
}

# Database: managed Cloud SQL for PostgreSQL. Private IP for the app (in-VPC),
# public IP + allowlist for direct developer access.
module "cloudsql" {
  source                 = "../../modules/cloudsql"
  name_prefix            = local.name_prefix
  region                 = var.region
  network_id             = module.network.network_id
  tier                   = var.db_tier
  highly_available       = var.db_highly_available
  point_in_time_recovery = var.db_point_in_time_recovery
  # Backups off for the dev showcase — durability comes from the suspend-time GCS dump
  # (run.sh suspend → `gcloud sql export`), not Cloud SQL's own daily backups. Set true
  # for a prod environment.
  backups_enabled = false
  # Deep-suspend cost toggle: DESTROY the instance when db_active is false (true ~$0 idle;
  # the data lives in the verified GCS dump, not on a kept disk). While the instance
  # EXISTS but compute is suspended, activation_policy STOPS it (no vCPU/RAM charge) — that
  # is the event-driven auto-suspend path, which flips environment_active but not db_active.
  instance_active     = var.db_active
  activation_policy   = var.environment_active ? "ALWAYS" : "NEVER"
  app_user_password   = random_password.db.result
  authorized_networks = var.db_authorized_networks
  labels              = local.common_labels
  # DELIBERATELY false — the instance is torn down every deep-suspend cycle, so it cannot
  # be protected (a count→0 destroy reads this from prior state). Data safety is the GCS
  # dump, not this flag. See the module's deletion_protection comment.
  deletion_protection = false
  # private_vpc_connection ensures the VPC peering (PSA) is fully established
  # before Cloud SQL tries to allocate a private IP on the peered range.
  # depends_on = [module.network] alone does not guarantee this ordering because
  # Terraform resolves module outputs lazily; the explicit output reference does.
  depends_on = [module.network.private_vpc_connection]
}

module "memorystore" {
  # Cost toggle: Valkey holds only disposable rate-limit/cache state, so it is fully
  # destroyed when suspended and re-created on resume. The redis-url/redis-ca-cert
  # secrets are conditionally omitted from app_secrets below while suspended.
  count            = var.environment_active ? 1 : 0
  source           = "../../modules/memorystore"
  name_prefix      = local.name_prefix
  region           = var.region
  project_id       = var.project_id
  network_id       = module.network.network_id
  highly_available = var.memory_highly_available
  labels           = local.common_labels
  # Valkey auto-creates its endpoints via PSC, which requires the service connection policy
  # (always-on in the network module) to exist first. It also needs the Memorystore API
  # enabled AND propagated — the instance create 403s on SERVICE_DISABLED for minutes after
  # enable, so depend on the api_propagation sleep (which itself waits on google_project_service.apis)
  # rather than the raw APIs resource.
  depends_on = [module.network.memorystore_psc_policy, time_sleep.api_propagation]
}

# Generated Cloud SQL app-user password. special=false keeps it URL-safe so it
# embeds cleanly in the Postgres connection string below.
resource "random_password" "db" {
  length  = 32
  special = false
}

module "iam" {
  source     = "../../modules/iam"
  project_id = var.project_id
  region     = var.region
  # Null when suspended (cluster destroyed); the iam module does not actually consume
  # this value, so an empty string is a safe placeholder that keeps the type (string).
  gke_cluster_name                = module.gke.cluster_name != null ? module.gke.cluster_name : ""
  gke_node_sa_email               = module.gke.node_service_account_email
  uploads_bucket_name             = module.gcs.bucket_name
  artifact_registry_repository_id = module.artifact_registry.repository_id
  github_repository               = var.github_repository
  github_owner_id                 = var.github_owner_id
  labels                          = local.common_labels

  # Binary Authorization attestor (modules/gke) — grants the deployer SA permission
  # to sign attestations + read vulnerability findings for the CI gate. The signer +
  # note-attacher grants are gated by binauthz_enabled (null wiring when disabled); the
  # project-level vulnerability-viewer grant stays on regardless.
  binauthz_enabled           = var.binauthz_enabled
  binauthz_note_id           = module.gke.binauthz_note_id
  binauthz_kms_crypto_key_id = module.gke.binauthz_kms_crypto_key_id

  # Secrets stored in Secret Manager and readable by the app SA via Workload Identity.
  # Infra creds come from module outputs / generated here; real 3rd-party creds
  # (Stripe/Resend/OAuth/OpenAI) come from var.third_party_secrets (gitignored tfvars)
  # so they are never committed. Both land as `devstash-<key>` and feed the ESO
  # ExternalSecret. DATABASE_URL/DIRECT_URL are NOT in tfvars — they point at the
  # managed Cloud SQL private IP and are derived from the generated password here.
  app_secrets = merge(var.third_party_secrets,
    # uploads-bucket is NOT here: module.gcs.bucket_name is deterministic
    # ("${project_id}-${name_prefix}-uploads", see modules/gcs/main.tf) and non-secret,
    # so AWS_S3_BUCKET is computed by the same CI yq formula as saEmail instead of
    # round-tripping through Secret Manager. See deploy-gke.yml + settings.yaml.

    # Managed Cloud SQL (modules/cloudsql). The app + migrate Job read these; the URL
    # targets the PRIVATE IP (in-VPC, no allowlist). Prisma uses the same URL for
    # DATABASE_URL and DIRECT_URL (no separate pooler). database-ca-cert lets the app's
    # node-postgres adapter verify the TLS chain (verify-CA); see src/lib/infra/db-local.ts.
    # Conditional: the instance is destroyed on a deep suspend, so these are omitted then
    # (the cluster is gone too, so ESO isn't consuming them) and re-created on resume.
    # module.cloudsql outputs are null when db_active is false.
    var.db_active ? {
      database-url     = module.cloudsql.database_url
      direct-url       = module.cloudsql.database_url
      database-ca-cert = module.cloudsql.server_ca_cert
    } : {},
    # Native Valkey: the app talks straight to Memorystore via node-redis (no SRH proxy).
    # IAM AUTH + in-transit TLS → rediss://; REDIS_CA_CERT verifies the Google-managed
    # server cert. The URL carries NO password — Valkey uses IAM auth, so the app supplies
    # a short-lived OAuth2 access token at runtime (REDIS_IAM_AUTH=true, set in the GKE
    # overlay). REDIS_URL takes precedence over the Upstash vars (src/lib/infra/redis.ts).
    # Conditional: Memorystore is destroyed when suspended, so these two secrets are
    # omitted then (and re-created on resume). module.memorystore is count-indexed.
    var.environment_active ? {
      redis-url     = "rediss://${module.memorystore[0].host}:${module.memorystore[0].port}"
      redis-ca-cert = module.memorystore[0].server_ca_cert
  } : {})

  # GCS-via-S3-interop credentials are minted INSIDE the iam module (HMAC key on
  # the app SA) and added to Secret Manager there — they can't be passed in via
  # app_secrets without a cycle (the key depends on the app SA the module owns).

  # google_project_service.apis — WIF pool/provider need iam/sts/iam-credentials APIs.
  # module.gke — <project>.svc.id.goog WI pool is auto-created with the GKE cluster;
  #   the SA WI binding fails if the cluster doesn't exist yet.
  # google_project_organization_policy.allow_sa_key_creation — ensures the project-level
  #   override (enforce=false) is applied before the HMAC key creation attempt.
  #   Note: GCP propagation is eventual (minutes), so a first-apply race is possible;
  #   see the comment on allow_sa_key_creation for details.
  depends_on = [google_project_service.apis, module.gke, google_project_organization_policy.allow_sa_key_creation]
}
