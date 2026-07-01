variable "project_id" {
  type        = string
  description = "GCP project ID to deploy into."
}

variable "region" {
  type        = string
  description = "GCP region for GKE, Memorystore, and GCS. Must match deploy-gke.yml. GCS Always Free applies only in us-west1, us-central1, or us-east1."
  default     = "us-central1"
}

variable "environment" {
  type        = string
  description = "Environment name, used in resource names + labels."
  default     = "dev"
}

# GitHub repo allowed to deploy via Workload Identity Federation (keyless CI).
variable "github_repository" {
  type        = string
  description = "GitHub repo permitted to deploy via WIF, \"owner/repo\" form."
}

variable "github_owner_id" {
  type        = string
  description = "Numeric GitHub owner (user/org) ID — pins the WIF condition to an immutable identity. Get it from https://api.github.com/users/<owner>."
}

# App domain — drives the Google-managed cert + NEXTAUTH_URL in overlays/gcp.
# DNS A-record for this domain must point at the Ingress static IP (network module).
variable "app_domain" {
  type        = string
  description = "Public hostname for the app, e.g. \"devstash.example.com\"."
}

# Sender identity for transactional email — non-secret, drives EMAIL_FROM in the
# devstash-config ConfigMap (infra/k8s/overlays/gcp/kustomization.yaml).
variable "email_from" {
  type        = string
  description = "\"From\" address for transactional email, e.g. \"DevStash <noreply@devstash.one>\"."
}

# Third-party credentials (Stripe, Resend, OAuth, OpenAI, auth-secret) that Terraform
# cannot derive — supplied via the gitignored terraform.tfvars. Each key K becomes
# Secret Manager secret `devstash-K`, granted to the app SA, and consumed by the
# ESO ExternalSecret (infra/k8s/overlays/gcp/external-secrets.yaml). See
# infra/docs/08-gcp-bootstrap.md §7b. Keys use kebab-case (e.g. "stripe-secret-key").
# NOTE: database-url/direct-url/redis-url are NOT here — Terraform derives them from
# the managed Cloud SQL + Memorystore modules.
# NOTE: email-from is NOT here — it is a non-secret constant (see var.email_from above).
#
# SENSITIVE MAP SEMANTICS (do not change without reading this):
# - `sensitive = true` on a map(string) redacts ALL values in plan/apply CLI output.
#   This is DISPLAY-ONLY: values are still stored in plain text in terraform.tfstate.
#   The real protection is the GCS backend with CMEK encryption. Never print state.
# - The entire map (and any expression derived from it via merge/lookup/[]) inherits
#   the sensitive taint. The IAM module uses `nonsensitive(keys(...))` for for_each
#   and accesses values inside resource bodies only — this is the correct pattern.
# - `default = {}`: if terraform.tfvars is absent, tofu plan will FAIL immediately on
#   the required-keys validation below (empty map → all required keys missing). This
#   gives a clear validation error rather than a generic "variable not set" error.
variable "third_party_secrets" {
  type        = map(string)
  sensitive   = true
  default     = {}
  description = "Real 3rd-party creds → Secret Manager. From terraform.tfvars only."

  # external-secrets.yaml references every key below unconditionally. Letting an
  # incomplete map reach apply creates healthy infrastructure but an ExternalSecret
  # that never becomes Ready, so CI times out before migrations. Fail at plan time.
  #
  # VALIDATION PATTERN: setsubtract(required_set, actual_keys) returns required keys
  # that are MISSING from the provided map. length == 0 means all required keys are
  # present. Argument order matters: setsubtract(A, B) = elements in A not in B.
  validation {
    condition = length(setsubtract(toset([
      "auth-secret",
      "auth-github-secret",
      "auth-google-secret",
      "resend-api-key",
      # Intentionally absent — non-secret config promoted OUT of Secret Manager to the
      # devstash-config ConfigMap (settings.yaml → kustomize replacement), not here:
      #   • "email-from"            → var.email_from
      #   • "auth-github-id" / "auth-google-id"  → OAuth CLIENT IDs (public, in redirects)
      #   • "stripe-publishable-key"             → public by Stripe's design (pk_...)
      #   • "stripe-price-id-monthly" / "-yearly" → non-sensitive identifiers (price_...)
      "stripe-secret-key",
      "stripe-webhook-secret",
      "openai-api-key",
    ]), toset(keys(var.third_party_secrets)))) == 0
    error_message = "third_party_secrets is missing one or more keys required by infra/k8s/overlays/gcp/external-secrets.yaml."
  }

  validation {
    condition     = alltrue([for value in values(var.third_party_secrets) : trimspace(value) != ""])
    error_message = "third_party_secrets values must not be empty."
  }

  validation {
    condition = alltrue([
      for value in values(var.third_party_secrets) :
      !strcontains(value, "...") && !strcontains(value, "openssl rand")
    ])
    error_message = "third_party_secrets still contains a terraform.tfvars.example placeholder."
  }
}

# Spaceship DNS API credentials — OPS creds (not app config). `run.sh resume` uses them
# to re-point the gke.* A-record at the freshly-allocated ingress IP after a suspend.
# Sourced from the gitignored terraform.tfvars like every other real credential, then
# pushed to Secret Manager by dns.tf (kept SEPARATE from third_party_secrets so they are
# NOT synced into the app's devstash-secrets). Empty default → DNS automation is skipped
# (you can still set the A-record via env vars or by hand). Get a key/secret in the
# Spaceship dashboard → API Manager.
variable "spaceship_api_key" {
  type        = string
  sensitive   = true
  default     = ""
  description = "Spaceship DNS API key for run.sh resume's A-record update. Empty disables DNS automation."
}

variable "spaceship_api_secret" {
  type        = string
  sensitive   = true
  default     = ""
  description = "Spaceship DNS API secret (pairs with spaceship_api_key)."
}

# Compute cost toggle (suspend / resume). Gates the stateless, re-creatable resources.
#
#   true  (default) — GKE Autopilot cluster, Memorystore, Cloud NAT, Cloud Armor, and
#                     the ingress IP all exist.
#   false           — all of the above are destroyed. Cloud SQL is NOT destroyed by this
#                     flag alone — it is merely STOPPED (activation_policy = NEVER) while
#                     the instance is kept (see db_active for the deep, DB-destroying path).
#
# Driven through to module.network (compute_active), module.gke (cluster_active),
# module.cloudsql (activation_policy), and module.memorystore (count). The event-driven
# auto-suspend (auto-suspend.tf) flips ONLY this — never db_active — so it can never
# destroy the database. Operated via `infra/gcp-run/run.sh suspend|resume`, which persist
# the value in active.auto.tfvars so a plain `tofu apply` keeps the chosen state. See
# infra/docs/10-suspend-resume.md.
variable "environment_active" {
  type        = bool
  default     = true
  description = "true = full compute running; false = compute suspended (GKE/Memorystore/NAT/Armor/ingress-IP destroyed). Does NOT by itself destroy Cloud SQL — the auto-suspend flips only this and the DB is merely STOPPED. See db_active for the deep, DB-destroying suspend."
}

# Deep-suspend toggle for the Cloud SQL INSTANCE itself (the run.sh suspend/resume path).
#
#   true  (default) — the Cloud SQL instance exists (running if environment_active, else
#                     STOPPED via activation_policy=NEVER but kept: disk ≈ $1.70/mo).
#   false           — the instance is DESTROYED (count → 0) for true ~$0 idle. The data
#                     is preserved out-of-band: run.sh suspend runs `gcloud sql export`
#                     to the GCS dump bucket and verifies it BEFORE setting this false;
#                     run.sh resume recreates the instance and `gcloud sql import`s it.
#
# Kept SEPARATE from environment_active on purpose: the event-driven auto-suspend flips
# only environment_active, so it can never trigger a DB-destroying apply without a dump —
# it just stops the instance. Only run.sh (which dumps first) ever sets this false.
# Persisted alongside environment_active in active.auto.tfvars.
variable "db_active" {
  type        = bool
  default     = true
  description = "true = Cloud SQL instance exists; false = destroyed for ~$0 idle (data kept in the GCS dump). Only run.sh suspend/resume flips this, and only after a verified dump. See infra/docs/10-suspend-resume.md."

  validation {
    # The app cannot run without its database. environment_active ⇒ db_active. Valid
    # states: (true,true) full, (false,true) compute-suspended/DB-stopped, (false,false)
    # deep-suspended. (true,false) — app up, DB destroyed — is rejected.
    condition     = !var.environment_active || var.db_active
    error_message = "db_active must be true whenever environment_active is true (the app cannot run without Cloud SQL)."
  }
}

# Retention for SUPERSEDED (noncurrent) Cloud SQL dumps in the GCS db-dumps bucket
# (db-dumps.tf). The CURRENT dump is NEVER deleted regardless of these — the lifecycle rules
# are scoped to archived versions only, so resume always has a dump no matter how long the
# env stays suspended. These bound only the rollback HISTORY. A dump is small (single-digit
# to low-tens of MB) and GCS us-central1 gives 5 GB-month free (shared with the uploads
# bucket), so raising these is effectively free until total storage approaches 5 GB — and
# only ~$0.02/GB/month beyond. A version is pruned when EITHER rule matches (older than the
# day cap OR beyond the version cap), whichever hits first.
variable "db_dump_keep_versions" {
  type        = number
  default     = 5
  description = "How many superseded (noncurrent) DB dumps to retain for rollback. The live dump is always kept on top of this and never expires. ~free for a small DB; raise freely. See db-dumps.tf."

  validation {
    condition     = var.db_dump_keep_versions >= 1
    error_message = "db_dump_keep_versions must be at least 1."
  }
}

variable "db_dump_keep_days" {
  type        = number
  default     = 90
  description = "Also expire any superseded DB dump older than this many days (cost bound; the live dump is exempt). Raise or set very high to keep history longer — it's ~free for a small DB."

  validation {
    condition     = var.db_dump_keep_days >= 1
    error_message = "db_dump_keep_days must be at least 1."
  }
}

# Cloud Billing budget (cost visibility). Account-scoped, not a per-project value, so
# it lives in the gitignored terraform.tfvars next to the other real values. Empty
# default → the budget resource (budget.tf) is not created. Format: "XXXXXX-XXXXXX-XXXXXX".
variable "billing_account" {
  type        = string
  default     = ""
  description = "Cloud Billing account ID for the monthly budget alert. Empty disables the budget. Find it: gcloud billing accounts list."
}

variable "monthly_budget_amount" {
  type        = number
  default     = 5
  description = "Monthly budget amount in USD for the threshold alerts (50/90/100%). Deliberately LOW: a correctly-suspending showcase costs ~$0/mo, so this is a tripwire, not a spend target. At $5 the 50% alert emails at $2.50 — within a day of a stuck/never-suspended env (the ~$0.13/hr running cost) — instead of hiding a runaway until it nears a real budget. Raise for a prod-like env with genuine steady spend."
}

# Database: managed Cloud SQL for PostgreSQL (modules/cloudsql).
variable "db_tier" {
  type        = string
  description = "Cloud SQL machine tier. db-f1-micro is the cheapest (shared-core) for dev; only valid on ENTERPRISE edition. If org policy forces ENTERPRISE_PLUS, use db-perf-optimized-N-2."
  default     = "db-f1-micro"
}

# CIDRs allowed to reach the Cloud SQL PUBLIC IP for direct developer access
# (psql/GUI). Empty by default — add your laptop's IP in terraform.tfvars, e.g.
# [{ name = "home", value = "203.0.113.4/32" }]. SSL is required regardless.
variable "db_authorized_networks" {
  type = list(object({
    name  = string
    value = string
  }))
  default = []
}

# Cloud SQL point-in-time recovery. Continuous WAL archiving adds log-storage cost
# on top of the daily backups (which stay on regardless). Off by default — daily
# backups are enough for dev. Set true in terraform.tfvars for a production env.
variable "db_point_in_time_recovery" {
  type        = bool
  default     = false
  description = "Enable Cloud SQL PITR (continuous WAL archiving). Extra cost; keep off for dev, set true for prod."
}

# Cloud SQL HA — standby replica in a second zone. Doubles SQL instance cost but
# gives automatic failover. Recommended for production; off by default for dev.
variable "db_highly_available" {
  type        = bool
  default     = false
  description = "Enable Cloud SQL high-availability (regional) mode. Doubles instance cost; recommended for production."
}

# Memorystore HA — STANDARD_HA tier adds a replica node.
# Without HA, the instance is BASIC (single node). Enable for production.
variable "memory_highly_available" {
  type        = bool
  default     = false
  description = "Enable Memorystore STANDARD_HA tier (replica node). Recommended for production."
}

variable "armor_waf_preview" {
  type        = bool
  default     = true
  description = "Preview Cloud Armor SQLi/XSS matches without blocking. Set false only after reviewing load-balancer logs for false positives."
}

# Cost toggle. Default FALSE in dev: Cloud Armor bills ~$5/mo policy + per-rule +
# per-request, and a gke.* showcase does not need an edge WAF. When false the policy is
# never created and CI injects an empty securityPolicy so the ingress attaches none. Set
# true in prod for edge DDoS/WAF protection. Independent of environment_active. Keep this
# in sync with the ARMOR_ENABLED CI variable (run.sh set-repo-secrets does it for you).
variable "armor_enabled" {
  type        = bool
  default     = false
  description = "Create + attach the Cloud Armor WAF policy. False = no edge WAF (dev $0 posture); true in prod."
}

# NOTE: currently INERT in this dev env. Both GKE and Cloud SQL are torn down and
# recreated on every suspend/resume cycle, so both hardcode deletion_protection = false
# (a protected resource cannot be count→0 destroyed in a single apply). Data safety comes
# from the verified GCS dump taken before every deep suspend (db-dumps.tf), not from this
# flag. Retained only so the auto-suspend tfvars blob keeps a stable shape and for parity
# with a would-be prod env (where you WOULD wire it back into the modules). Setting it
# true here does NOT protect anything.
variable "deletion_protection" {
  type        = bool
  default     = true
  description = "INERT in dev (both GKE + Cloud SQL are always torn down on suspend; data safety is the GCS dump). Retained for prod parity."
}

# Binary Authorization / KMS supply-chain enforcement. Default FALSE in dev: KMS has no
# free tier, so the always-on signing key is the single standing resource that can never
# round to $0 while the environment is deep-suspended. Disabling it (never applied live in
# dev) means the KMS key is never created — a literal $0 idle footprint. Set true in prod.
# When false, the CI "Sign images for Binary Authorization" step self-skips (its BINAUTHZ_*
# repo variables are unset) and run.sh does not publish them.
variable "binauthz_enabled" {
  type        = bool
  default     = false
  description = "Provision the Binary Authorization signing pipeline (KMS key, attestor, note, policy, cluster enforcement + deployer signing IAM). False = omit it for a $0 idle footprint."
}

# ── Idle auto-suspend (infra/terraform/envs/dev/auto-suspend.tf) ──
# Event-driven, no scheduler: a Cloud Monitoring alert on "zero ingress-LB requests for
# auto_suspend_idle_window_seconds" publishes to a Pub/Sub topic that triggers a Cloud
# Build. The build DUMPS Cloud SQL to the GCS db-dumps bucket + verifies it, then runs
# `tofu apply -var environment_active=false -var db_active=false` — the unattended deep
# suspend to true ~$0, so a forgotten env can't drain credits. The build runs as a
# dedicated, least-privileged "lifecycle" SA (NOT the deploy SA) and re-checks idleness
# before acting, so it can never suspend a busy env; a failed/empty dump fails the build so
# an un-dumped instance is never destroyed. RESUME IS NEVER AUTOMATED — this only drives the
# env DOWN; bring it back with `run.sh resume` (which restores the dump). See
# infra/docs/10-suspend-resume.md.
#
# ON BY DEFAULT: this is a personal on-demand showcase, so the safe default is "guard the
# credits automatically." All auto-suspend resources are ~$0 when idle (Monitoring
# alerting + the first 10 GB/mo of Pub/Sub are free; Cloud Build runs only on an actual
# idle transition). Set false to opt OUT of automated suspension.
variable "auto_suspend_enabled" {
  type        = bool
  default     = true
  description = "Create the Monitoring-alert → Pub/Sub → Cloud Build idle auto-suspend (dumps + deep-suspends via a dedicated lifecycle SA). ON by default so a forgotten env can't drain credits; set false to opt out."
}

variable "auto_suspend_idle_window_seconds" {
  type        = number
  default     = 300
  description = "Idle window: suspend only after the ingress LB has seen zero requests for this many trailing seconds. Also gates the build's re-check + a fresh-resume grace (cluster younger than this is left alone). Default 5m (the alert's alignment-period floor) — the env is at the per-resource cost floor, so the only remaining running-cost lever is shrinking this idle tail (NAT+LB+SQL+Redis run at ~$0.13/hr while up). A cold resume after suspend is ~1-2 min, acceptable for a showcase. NOTE: this path only catches GENUINELY idle windows; public-IP scanner traffic keeps request_count > 0 and defeats it — the scanner-proof backstop is auto_suspend_max_uptime_seconds below. Keep >= 300 (must be >= the alert alignment_period)."

  validation {
    condition     = var.auto_suspend_idle_window_seconds >= 300
    error_message = "auto_suspend_idle_window_seconds must be at least 300 (the Monitoring alert alignment_period floor)."
  }
}

# Scanner-proof hard cap. The idle-window path above suspends only on ZERO ingress traffic,
# which internet background scanners hitting the public LB IP can defeat indefinitely
# (request_count never reaches 0 → the metric-absence alert never fires → the env never
# suspends → ~$0.13/hr bleeds 24/7). This is the guaranteed backstop: a Cloud Scheduler cron
# (auto-suspend.tf) fires REGARDLESS of traffic, and the guard suspends unconditionally once
# the cluster is older than this — immune to scanner noise. Because resume is deliberate and
# manual (you bring the env up to show someone), an unconditional teardown this long after
# resume is exactly right for an on-demand showcase. Set very high to effectively disable the
# cap and rely only on the idle-traffic path (NOT recommended for a public LB).
variable "auto_suspend_max_uptime_seconds" {
  type        = number
  default     = 5400
  description = "Hard uptime cap: the auto-suspend build tears the env down once the cluster is older than this many seconds, regardless of traffic (scanner-proof backstop to the idle-traffic path). Default 90m. Must be >= auto_suspend_idle_window_seconds."

  validation {
    condition     = var.auto_suspend_max_uptime_seconds >= var.auto_suspend_idle_window_seconds
    error_message = "auto_suspend_max_uptime_seconds must be >= auto_suspend_idle_window_seconds (the cap can't be shorter than the idle window)."
  }
}

# Cloud Scheduler cadence for the hard-uptime-cap backstop. The cron publishes to the same
# auto-suspend Pub/Sub topic the idle alert uses; the guard then decides (age-cap OR
# zero-traffic). Every 15 min keeps the worst-case overshoot past max_uptime to <= this
# interval while staying trivially inside Cloud Scheduler's 3-free-jobs tier.
variable "auto_suspend_schedule_cron" {
  type        = string
  default     = "*/15 * * * *"
  description = "Cron schedule for the Cloud Scheduler job that fires the hard-uptime-cap suspend check (unicron format, evaluated in America/Chicago — us-central1 local time). The guard is idempotent and re-checks liveness, so a frequent cadence is harmless."
}

variable "log_system_exclusion_enabled" {
  type        = bool
  default     = true
  description = "Exclude GKE system-namespace container logs (kube-system, gke-managed-*, gmp-system) from Cloud Logging ingestion to stay inside the 50 GiB/mo always-free tier. App/web logs (infra/docs/11-logs.md) are untouched. Set false to ingest everything (e.g. when debugging a cluster-system issue). See logging.tf."
}

variable "auto_suspend_repo_branch" {
  type        = string
  default     = "main"
  description = "Git branch the suspend build checks out of github_repository. Point at a feature branch to test before merge."
}

# GKE Autopilot: no node VM variables — Google manages nodes; pay per pod.
