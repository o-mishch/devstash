#!/usr/bin/env bash
# One-shot: stand up the full GCP deploy of DevStash on GKE Autopilot — the cloud
# analog of infra/run/local/run.sh. Idempotent: every step checks existence
# before creating, so re-runs are safe.
#
# What the LOCAL run.sh does on kind, this does on GCP. The heavy infra (VPC, GKE,
# Memorystore, IAM, WIF, Secret Manager, Artifact Registry, GCS, Ingress IP) is
# defined in Terraform (infra/terraform/envs/dev). This script automates the parts
# that, by definition, can't be committed and must exist BEFORE `tofu init`
# (project, billing, ADC, state bucket, APIs), then drives Terraform, wires the
# GitHub Actions secrets from `tofu output`, and prints the DNS/cert step.
# Full manual walkthrough: infra/docs/08-gcp-bootstrap.md.
#
# Usage:
#   bash infra/run/gcp/run.sh up             bootstrap → terraform apply → gh secrets → fix DNS
#   bash infra/run/gcp/run.sh bootstrap      project/billing/ADC/state-bucket/APIs only
#   bash infra/run/gcp/run.sh apply          terraform init + apply, then re-point the gke.* A-record
#   bash infra/run/gcp/run.sh eso            install External Secrets Operator (once per cluster)
#   bash infra/run/gcp/run.sh reloader       install Stakater Reloader (once per cluster)
#   bash infra/run/gcp/run.sh secrets        push GCP_PROJECT_ID/DEPLOYER_SA/WIF + APP_DOMAIN to GitHub
#   bash infra/run/gcp/run.sh verify-secrets check all expected Secret Manager secrets exist + ESO sync status
#   bash infra/run/gcp/run.sh rotate-secret  <name-suffix>   securely prompt for value + force ESO sync
#   bash infra/run/gcp/run.sh upgrade-helm   bump ESO + Reloader to latest chart versions + apply to cluster
#   bash infra/run/gcp/run.sh deploy         trigger the deploy-gke CI workflow (build+migrate+rollout)
#   bash infra/run/gcp/run.sh smoke          wait for latest CI run + health-check the app
#   bash infra/run/gcp/run.sh status         show cluster / ingress IP / cert / pod health
#   bash infra/run/gcp/run.sh logs           tail app pod logs (last 100 lines, all pods)
#   bash infra/run/gcp/run.sh suspend        cost→~$0: dump Cloud SQL to GCS, then destroy compute + DB
#   bash infra/run/gcp/run.sh resume         recreate compute + Cloud SQL, restore dump, redeploy, fix DNS
#   bash infra/run/gcp/run.sh dump-db        ad-hoc: export Cloud SQL to the GCS db-dumps bucket (no suspend)
#   bash infra/run/gcp/run.sh restore-db     import the latest GCS dump into the current Cloud SQL instance
#   bash infra/run/gcp/run.sh update-dns     re-point the gke.* A-record at the current ingress IP (Spaceship API)
#   bash infra/run/gcp/run.sh set-dns-creds  store Spaceship DNS API key/secret in Secret Manager
#   bash infra/run/gcp/run.sh down           tofu destroy (tear everything down, incl. Cloud SQL)
#
# SUSPEND/RESUME (on-demand showcase, true ~$0 while idle):
#   `suspend` first DUMPS Cloud SQL to the GCS db-dumps bucket (`gcloud sql export`) and
#   verifies the dump, THEN flips environment_active=false + db_active=false (persisted in
#   active.auto.tfvars) and applies: the GKE cluster, Memorystore, Cloud NAT, Cloud Armor,
#   the ingress IP AND the Cloud SQL instance are all destroyed. Idle cost ≈ $0 (the small
#   GCS dump sits in the Always-Free tier). `resume` recreates everything, RESTORES the DB
#   from the dump (`gcloud sql import`), and re-points the gke.* DNS A-record at the
#   freshly-allocated ingress IP via the Spaceship API. There is NO wake-on-request —
#   resume is an explicit ~minutes operation.
#
#   Data safety: the dump is taken and verified BEFORE any destroy, so a failed dump aborts
#   the suspend with the instance intact. The event-driven auto-suspend (auto-suspend.tf)
#   flips ONLY environment_active, so it never destroys the DB — it just stops the instance.
#
# Env overrides (otherwise read from terraform.tfvars / auto-detected):
#   BILLING_ACCOUNT=XXXXXX-XXXXXX-XXXXXX   billing account to link (else first open one)
#   AUTO_APPROVE=1                         skip the confirmation before `tofu apply`/`destroy`
set -euo pipefail
cd "$(dirname "$0")/../../.."   # repo root

TF_DIR=infra/terraform/envs/dev
TFVARS="$TF_DIR/terraform.tfvars"
STATE_BUCKET="${STATE_BUCKET:-}"
# GCS lifecycle config for the out-of-band state bucket. Kept as a standalone JSON file
# (not an inline heredoc) so it is diffable, jq-validatable, and reviewable as JSON.
STATE_LIFECYCLE=infra/run/gcp/tfstate-lifecycle.json
PLAN_FILE=devstash.tfplan
NS=devstash
DB_NAME=devstash   # logical DB inside the Cloud SQL instance (dump/restore --database target)
CMD="${1:-up}"

# Helm failure policy passed to the shared infra/ci/ensure-*.sh installers. Locally we run
# a modern Helm where "--atomic" is deprecated in favour of "--rollback-on-failure", so use
# the non-deprecated flag here. CI keeps the scripts' default ("--atomic") because the
# ubuntu-latest runner still ships Helm 3, which lacks "--rollback-on-failure".
export HELM_FAILURE_POLICY="--rollback-on-failure"

# Pinned Helm chart versions — single source of truth shared with deploy-gke.yml.
# shellcheck source-path=SCRIPTDIR
# shellcheck source=../../versions.env
source "$(dirname "$0")/../../versions.env"
# Shared image coordinates (DEVSTASH_IMAGES, ds_image_base) — the same helpers the CI
# scripts source, so run.sh and infra/ci/*.sh never drift on the registry path.
# shellcheck source=../../lib/common.sh
source "$(dirname "$0")/../../lib/common.sh"

# ── helpers ────────────────────────────────────────────────────────────────
# log/ok/warn/die + need() are provided by the sourced infra/lib/common.sh (shared with
# infra/run/local/run.sh so both orchestrators speak one logging/preflight vocabulary).

confirm() {
  [[ "${AUTO_APPROVE:-}" == "1" ]] && return 0
  read -r -p "$1 [y/N] " reply
  [[ "$reply" == "y" || "$reply" == "Y" ]]
}

# Read a scalar from terraform.tfvars (single source of truth for project/region).
tfvar() {
  [[ -f "$TFVARS" ]] || return 1
  grep -E "^[[:space:]]*$1[[:space:]]*=" "$TFVARS" | head -1 \
    | sed -E 's/^[^=]*=[[:space:]]*"?([^"#]*[^"# ])"?.*$/\1/'
}

tofu_() { tofu -chdir="$TF_DIR" "$@"; }

# tf_out <output-name> [fallback]: soft-read a raw tofu output, swallowing the error and
# returning [fallback] (default empty) when the output is absent — the normal case for a
# suspended or not-yet-applied env. Centralises the `2>/dev/null || <default>` so call sites
# read as intent, not incantation. Use plain `tofu_ output -raw` (NOT this) where a missing
# output must fail loudly (e.g. pushing required GitHub secrets).
tf_out() { tofu_ output -raw "$1" 2>/dev/null || printf '%s' "${2:-}"; }

# app_config_blob: print the devstash-app-config JSON from its newest ENABLED version, or
# nothing (empty output, non-fatal) if the secret is absent/has no enabled version. The
# newest-ENABLED-version resolution (and the reason we avoid `access latest`) lives in
# ds_newest_enabled_secret_version (infra/lib/common.sh), shared with the CI tooling.
app_config_blob() {
  local ver
  ver="$(ds_newest_enabled_secret_version devstash-app-config "$PROJECT_ID")"
  [[ -n "$ver" ]] || return 0
  gcloud secrets versions access "$ver" --secret=devstash-app-config --project="$PROJECT_ID" 2>/dev/null || true
}

# use_cluster / use_cluster_soft: point kubeconfig at the GKE cluster via the tofu-emitted
# get_credentials_command. `use_cluster` aborts if no cluster exists; the _soft variant only
# warns and continues (for read-only status/log commands that still work partially offline).
# Optional $1 overrides the default message. Guard on the `gcloud*` prefix before eval-ing:
# when the env is suspended, get_credentials_command is a human-readable sentinel (NOT a gcloud
# command), so eval-ing it is meaningless — bail with the same message as a missing cluster.
# This is the guard apply() applies inline (line ~493); centralising it here makes every caller
# (eso/status/rotate-secret/verify-secrets/upgrade-helm) sentinel-safe, not just apply().
use_cluster() {
  local c; c="$(tofu_ output -raw get_credentials_command 2>/dev/null || true)"
  [[ "$c" == gcloud* ]] || die "${1:-no cluster yet — run 'apply' first}"
  eval "$c"
}
use_cluster_soft() {
  local c; c="$(tofu_ output -raw get_credentials_command 2>/dev/null || true)"
  [[ "$c" == gcloud* ]] || { warn "${1:-no cluster yet}"; return 0; }
  eval "$c" 2>/dev/null || warn "${1:-no cluster yet}"
}

# helm_repo <name> <url>: register (idempotent — ignore "already exists") + refresh a single
# Helm chart repo. Used by upgrade_helm to freshen both repos before querying latest versions
# (eso/reloader delegate their repo add+update to infra/ci/ensure-*.sh).
helm_repo() {
  helm repo add "$1" "$2" >/dev/null 2>&1 || true
  helm repo update "$1" >/dev/null
}

# count_missing "<newline-list>" item…: for each item, ok if present in the list (exact-line
# match) else warn "MISSING". Returns the count of missing items so callers can gate on it —
# capture with `count_missing … || missing=$?` (the non-zero return would otherwise trip set -e).
count_missing() {
  local have="$1"; shift
  local n=0 item
  for item in "$@"; do
    if echo "$have" | grep -qx "$item"; then
      ok "$item"
    else
      warn "MISSING: $item"
      n=$((n + 1))
    fi
  done
  return "$n"
}

# poll_until <max_attempts> <sleep_secs> -- <cmd…>: run <cmd> repeatedly until it exits 0 or
# <max_attempts> is reached, printing a dot per attempt. Returns 0 on success, 1 on timeout.
# The caller prints its own trailing newline + success/failure message so the wording stays
# specific to what was being waited on. Pass a quiet predicate (e.g. a small helper that
# redirects its own noisy command) so only the progress dots reach the terminal.
poll_until() {
  local attempts="$1" gap="$2"; shift 2
  [[ "${1:-}" == "--" ]] && shift
  local i=0
  until "$@"; do
    i=$((i + 1))
    [[ $i -lt $attempts ]] || return 1
    printf '.'
    sleep "$gap"
  done
}

# wait_for_cluster: poll `kubectl cluster-info` until the GKE Autopilot control plane responds
# (typically 5-7 min after `tofu apply` completes). Times out after 10 minutes with an
# actionable error pointing to the GCP console. Called by the up / apply / resume flows.
_cluster_reachable() { kubectl cluster-info >/dev/null 2>&1; }
wait_for_cluster() {
  log "Waiting for GKE cluster control plane to become reachable (Autopilot takes 5-7 min)"
  poll_until 60 10 -- _cluster_reachable \
    || die "Cluster not reachable after 10 minutes — check GCP console"
  echo
  ok "cluster reachable"
}

# preflight: assert every required CLI is on PATH. Fail fast with an install hint so
# the user fixes the environment before any GCP or Terraform call is attempted.
preflight() {
  log "Preflight — required CLIs"
  need gcloud "https://cloud.google.com/sdk/docs/install"
  need tofu   "https://opentofu.org/docs/intro/install (or use terraform)"
  need gh     "https://cli.github.com"
  need kubectl "https://kubernetes.io/docs/tasks/tools/"
  need helm   "https://helm.sh/docs/intro/install"
  need jq     "brew install jq"
  need yq     "brew install yq"
  ok "all CLIs present"
}

# Ensure terraform.tfvars exists and is filled. On first run we scaffold it and stop
# so the user can paste real values (project_id, github_*, app_domain, 3rd-party creds).
ensure_tfvars() {
  if [[ ! -f "$TFVARS" ]]; then
    cp "$TFVARS.example" "$TFVARS"
    warn "Created $TFVARS from the example."
    warn "Fill in: project_id, github_repository, github_owner_id, app_domain,"
    warn "and the real third_party_secrets (Stripe/Resend/OAuth/OpenAI/auth-secret)."
    warn "  github_owner_id:  curl -s https://api.github.com/users/<owner> | jq .id"
    warn "  auth-secret:      openssl rand -base64 32"
    die  "Edit $TFVARS, then re-run."
  fi
  PROJECT_ID="$(tfvar project_id)"; [[ -n "${PROJECT_ID:-}" ]] || die "project_id not set in $TFVARS"
  REGION="$(tfvar region)";         REGION="${REGION:-us-central1}"
  ENVIRONMENT="$(tfvar environment)"; ENVIRONMENT="${ENVIRONMENT:-dev}"
  APP_DOMAIN="$(tfvar app_domain)"
  # GCS bucket names are global. Deriving the backend bucket from the globally unique
  # project ID avoids collisions; STATE_BUCKET remains an explicit escape hatch for an
  # existing backend. backend.tf is intentionally partial and receives this at init.
  STATE_BUCKET="${STATE_BUCKET:-${PROJECT_ID}-tfstate-${ENVIRONMENT}}"
  # Detect unfilled third_party_secrets placeholders from terraform.tfvars.example:
  #   sk_...       → Stripe secret key (sk_test_... or sk_live_...)
  #   whsec_...    → Stripe webhook secret
  #   re_...       → Resend API key
  #   openssl rand → auth-secret placeholder (the example value is the shell command,
  #                  not the actual random bytes — must be replaced with a real secret)
  # Extend this pattern if new placeholder conventions are added to tfvars.example.
  if grep -qE 'sk_\.\.\.|whsec_\.\.\.|re_\.\.\.|openssl rand' "$TFVARS"; then
    die "third_party_secrets still contain placeholders. Fill real values in $TFVARS before apply (08-gcp-bootstrap.md §7b). Pods will not start until every secret is set."
  fi
}

# ── steps ──────────────────────────────────────────────────────────────────

# bootstrap: everything that must exist in GCP *before* `tofu init` can run.
# In order: gcloud login check → project create/select → billing link → ADC →
# state bucket create + harden → required APIs enable. All steps are idempotent
# (each checks existence before acting), so re-running after a partial failure is safe.
bootstrap() {
  ensure_tfvars
  log "GCP bootstrap for project '$PROJECT_ID' (region $REGION)"

  # Logged in?
  gcloud auth list --filter=status:ACTIVE --format='value(account)' | grep -q . \
    || { warn "no active gcloud account — launching login"; gcloud auth login; }
  ok "gcloud authenticated"

  # Project (global-unique). Create only if we can't describe it.
  if gcloud projects describe "$PROJECT_ID" >/dev/null 2>&1; then
    ok "project exists"
  else
    log "Creating project $PROJECT_ID"
    gcloud projects create "$PROJECT_ID" --name="DevStash"
  fi
  gcloud config set project "$PROJECT_ID" >/dev/null
  ok "active project set"

  # Billing — most APIs (and the $300 credit) require a linked account.
  if [[ "$(gcloud billing projects describe "$PROJECT_ID" --format='value(billingEnabled)' 2>/dev/null)" == "True" ]]; then
    ok "billing linked"
  else
    local acct="${BILLING_ACCOUNT:-}"
    [[ -n "$acct" ]] || acct="$(gcloud billing accounts list --filter=open=true --format='value(name)' | head -1)"
    [[ -n "$acct" ]] || die "no open billing account found — set BILLING_ACCOUNT=XXXXXX-XXXXXX-XXXXXX"
    log "Linking billing account $acct"
    gcloud billing projects link "$PROJECT_ID" --billing-account="$acct"
  fi

  # Application Default Credentials — the Terraform google provider reads these.
  if gcloud auth application-default print-access-token >/dev/null 2>&1; then
    ok "ADC present"
  else
    warn "no ADC — launching application-default login"
    gcloud auth application-default login
  fi

  # Terraform state bucket (chicken-and-egg: must exist before `tofu init`).
  if gcloud storage buckets describe "gs://$STATE_BUCKET" >/dev/null 2>&1; then
    ok "state bucket gs://$STATE_BUCKET exists"
  else
    log "Creating state bucket gs://$STATE_BUCKET (single-region $REGION)"
    # Single-region (us-central1), not the US multi-region: lower cost, co-located
    # with the rest of the stack. Location is IMMUTABLE — an existing bucket in a
    # different location must be recreated + state migrated, not updated in place.
    gcloud storage buckets create "gs://$STATE_BUCKET" --location="$REGION"
  fi
  # Reconcile security properties even for a pre-existing bucket. Existence alone
  # does not prove that state has object version recovery or that ACL/public access
  # paths are disabled.
  gcloud storage buckets update "gs://$STATE_BUCKET" \
    --uniform-bucket-level-access --public-access-prevention --versioning
  ok "state bucket has uniform access, public-access prevention, and versioning"

  # Lifecycle: versioning above keeps every superseded state generation forever. State
  # objects are tiny, but over the env's life the noncurrent versions accumulate unbounded.
  # The rule (in $STATE_LIFECYCLE) keeps the 2 most recent noncurrent generations for rollback
  # (3 total incl. the live state) and drops older ones regardless of age — ARCHIVED-only
  # (isLive=false), so the LIVE state object is never touched — keeping the bucket a $0 residual.
  gcloud storage buckets update "gs://$STATE_BUCKET" --lifecycle-file="$STATE_LIFECYCLE"
  ok "state bucket lifecycle: keep 2 noncurrent state versions (3 total), drop older regardless of age"

  # Enable APIs up front (Terraform also does this via google_project_service, but
  # pre-enabling here speeds up the first `tofu apply` by avoiding Terraform's
  # per-API enable wait. Must stay in sync with the list in infra/terraform/envs/dev/main.tf.
  # --project is explicit here even though `gcloud config set project` was called above,
  # because gcloud config is mutable across terminals and explicit is safer.
  log "Enabling required APIs (idempotent)"
  gcloud services enable --project="$PROJECT_ID" \
    compute.googleapis.com container.googleapis.com \
    sqladmin.googleapis.com \
    artifactregistry.googleapis.com secretmanager.googleapis.com \
    iam.googleapis.com iamcredentials.googleapis.com sts.googleapis.com \
    servicenetworking.googleapis.com memorystore.googleapis.com \
    orgpolicy.googleapis.com \
    binaryauthorization.googleapis.com \
    containeranalysis.googleapis.com \
    cloudresourcemanager.googleapis.com
  ok "APIs enabled"
}

# reconcile_state: heal state↔cloud drift that a plain `tofu plan` cannot resolve, so a
# single `run.sh apply` is enough. Populates the RECONCILE_REPLACE array with any -replace
# targets for the caller to fold into `tofu plan`. MUST run AFTER `tofu init` (needs state).
# Both branches are self-disabling — once healed, subsequent applies are no-ops.
#
#   1. Cloud SQL `devstash` database present in the instance but ABSENT from state. The
#      ABANDON deletion policy (modules/cloudsql) drops the DB resource from state on a
#      db_active toggle WITHOUT dropping the physical database, so re-activating collides
#      with "database already exists". Import the existing database instead of recreating it.
#   2. The PSC subnet tracked with the legacy purpose PRIVATE_SERVICE_CONNECT. Memorystore
#      service-connectivity automation requires an ordinary PRIVATE subnet, and GCP cannot
#      PATCH a subnet's purpose in place — so the subnet must be REPLACED, not updated.
#   3. The Artifact Registry repo DELETED out-of-band by a deep-suspend (auto-suspend step 5
#      / `run.sh suspend` run `artifactregistry.repositories.delete` on the WHOLE repo for $0
#      idle storage — see infra/docs/10-suspend-resume.md), yet still tracked in state along
#      with its four repo-scoped IAM members. On resume, refreshing those IAM members calls
#      getIamPolicy on the vanished repo, and GCP answers 403 (NOT 404) for an IAM read on a
#      missing resource — aborting the apply before the repo can be recreated. `state rm` the
#      repo + its members so the next plan recreates them cleanly (nothing exists remotely, so
#      there is no name-conflict on re-create). CI rebuilds+repushes the images after apply.
reconcile_state() {
  RECONCILE_REPLACE=()
  local db_addr='module.cloudsql.google_sql_database.devstash[0]'
  local subnet_addr='module.network.google_compute_subnetwork.psc'
  # _in_state <addr>: true iff <addr> is tracked in state. Filters by the exact address
  # (authoritative — no whole-list grep) so an unrelated line can't fool it. Used by all
  # three reconcile branches below.
  _in_state() { tofu_ state list "$1" 2>/dev/null | grep -qxF "$1"; }

  # 1. Adopt an untracked-but-existing Cloud SQL database. The presence check filters state
  # by the exact address (authoritative — no whole-list grep) so it can't be fooled by an
  # unrelated line. The import is idempotent: a stale/locked state read right after `init`
  # could miss an address that import then reports as already-managed, so treat that outcome
  # as success and only fail if the address is genuinely still absent afterwards.
  #
  # ONLY when db_active=true (resume/apply-up). The devstash database resource is count-gated
  # on instance_active (= db_active); during a suspend (db_active=false) its config is count→0,
  # so an import target has no configuration and `tofu import` fails with "Configuration for
  # import target does not exist" — blocking the very suspend that is meant to destroy the DB.
  # A suspend WANTS the physical database gone, so there is nothing to adopt: skip the import.
  local db_active
  db_active="$(sed -nE 's/^[[:space:]]*db_active[[:space:]]*=[[:space:]]*(true|false).*/\1/p' \
    "$TF_DIR/active.auto.tfvars" 2>/dev/null | head -1)"
  if [[ "$db_active" != "false" ]] && ! _in_state "$db_addr"; then
    local inst
    inst="$(tf_out db_instance_name)"
    if [[ -n "$inst" ]] && gcloud sql databases describe "$DB_NAME" \
         --instance="$inst" --project="$PROJECT_ID" >/dev/null 2>&1; then
      log "Reconcile: importing existing Cloud SQL database '$DB_NAME' into state (abandoned by a prior db-active toggle)"
      if tofu_ import -lock-timeout=120s "$db_addr" \
           "projects/$PROJECT_ID/instances/$inst/databases/$DB_NAME"; then
        ok "database '$DB_NAME' adopted into state"
      elif _in_state "$db_addr"; then
        warn "database '$DB_NAME' was already managed in state — import skipped"
      else
        die "failed to import $db_addr — resolve manually, then re-run apply"
      fi
    fi
  fi

  # 2. Force-replace a legacy-purpose PSC subnet (purpose is immutable → cannot be patched).
  local purpose
  purpose="$(tofu_ state show "$subnet_addr" 2>/dev/null \
    | sed -nE 's/^[[:space:]]*purpose[[:space:]]*=[[:space:]]*"([^"]+)".*/\1/p' | head -1)"
  if [[ "$purpose" == "PRIVATE_SERVICE_CONNECT" ]]; then
    warn "Reconcile: PSC subnet has legacy purpose PRIVATE_SERVICE_CONNECT — scheduling a replace with a PRIVATE subnet"
    RECONCILE_REPLACE+=("-replace=$subnet_addr")
  fi

  # 3. Forget an Artifact Registry repo a deep-suspend deleted out-of-band but state still
  # tracks. The repo id is the literal from modules/artifact-registry ("devstash"). Only act
  # when the repo is ABSENT in GCP (describe fails) AND its resource is PRESENT in state — so
  # this self-disables the moment the next plan recreates it. The four repo-scoped IAM members
  # are removed alongside the repo: their getIamPolicy refresh is exactly what 403s on the
  # missing repo. Filter state by each exact address (authoritative — no whole-list grep). The
  # count-gated addresses ([0]) may be absent depending on toggles, so rm each individually and
  # tolerate an already-absent one rather than failing the whole reconcile.
  local ar_repo='devstash'
  local ar_repo_addr='module.artifact_registry.google_artifact_registry_repository.docker'
  if _in_state "$ar_repo_addr" \
     && ! gcloud artifacts repositories describe "$ar_repo" \
            --location="$REGION" --project="$PROJECT_ID" >/dev/null 2>&1; then
    warn "Reconcile: Artifact Registry repo '$ar_repo' was deleted by a deep-suspend but is still in state — forgetting the repo + its IAM members so the apply recreates them"
    local ar_addr
    for ar_addr in \
      'module.iam.google_artifact_registry_repository_iam_member.node_artifact_registry_reader' \
      'module.iam.google_artifact_registry_repository_iam_member.custom_node_artifact_registry_reader[0]' \
      'module.iam.google_artifact_registry_repository_iam_member.deployer_artifact_registry' \
      'google_artifact_registry_repository_iam_member.lifecycle_ar_delete[0]' \
      "$ar_repo_addr"; do
      if _in_state "$ar_addr"; then
        tofu_ state rm -lock-timeout=120s "$ar_addr" \
          || die "failed to forget $ar_addr — resolve manually, then re-run apply"
      fi
    done
    ok "Artifact Registry repo + IAM members forgotten — the plan will recreate them"
  fi
}

# wait_for_no_autosuspend_build: serialise against the scheduled idle auto-suspend Cloud
# Build. That build and any human `run.sh apply/suspend/resume` share ONE OpenTofu state
# lock; if both run at once the second dies with "Error acquiring the state lock" mid-flight
# (and cancelling the build to break the collision can orphan the lock AND leave a half-torn-
# down environment). The remote lock alone can't prevent this — it only rejects the loser
# AFTER it starts. So pre-check the CI side the way CI concurrency-groups serialise applies:
# if an auto-suspend build for THIS env is QUEUED/WORKING, wait for it to finish before we
# touch state. Bounded so a genuinely stuck build can't hang the human command forever —
# on timeout we bail with an actionable message rather than racing the lock. The reverse
# direction (build starts while a human holds the lock) is handled by the guard step in
# auto-suspend-guard.sh, and the residual window where a build starts in the split second
# after this check clears is caught by -lock-timeout on the tofu commands below.
wait_for_no_autosuspend_build() {
  # Match by the trigger's NAME (Cloud Build's built-in TRIGGER_NAME substitution), which is
  # stable across trigger replaces — unlike buildTriggerId, which is regenerated whenever the
  # trigger is recreated. One server-side --filter, no per-build describe.
  local trigger="devstash-${ENVIRONMENT}-auto-suspend"
  local deadline=$(( SECONDS + 900 ))  # cap the wait so a stuck build can't hang us forever
  local id
  while :; do
    id="$(gcloud builds list --region="$REGION" --project="$PROJECT_ID" --ongoing \
            --filter="substitutions.TRIGGER_NAME=$trigger" \
            --format='value(id)' 2>/dev/null | head -1)"
    [[ -z "$id" ]] && return 0
    if (( SECONDS >= deadline )); then
      die "auto-suspend build $id ($trigger) still running after 900s — it holds the state lock. Wait for it to finish (gcloud builds log $id --region=$REGION) or cancel it, then re-run."
    fi
    warn "auto-suspend build $id ($trigger) is running and holds the state lock — waiting for it to finish before applying…"
    sleep 20
  done
}

# apply: initialise the Terraform remote backend and run plan → apply.
# Requires the state bucket to exist (bootstrap must have run first).
# Always plans to a file and applies that exact plan so there is no drift between
# the reviewed diff and what actually mutates GCP. The plan file is gitignored and
# deleted after apply (success or failure) so no sensitive state lingers on disk.
apply() {
  ensure_tfvars
  # Delete any stale plan file to ensure a fresh start
  rm -f "$PLAN_FILE" "$TF_DIR/$PLAN_FILE"
  # Guard: the GCS state bucket must exist before `tofu init` can initialise the
  # remote backend. If `bootstrap` was skipped, the init fails with a cryptic
  # "bucket not found" error. Check explicitly so the message is actionable.
  if ! gcloud storage buckets describe "gs://$STATE_BUCKET" >/dev/null 2>&1; then
    die "State bucket gs://$STATE_BUCKET not found — run 'bootstrap' first to create it."
  fi
  # Serialise against the scheduled idle auto-suspend build BEFORE touching state — they share
  # one lock and would otherwise collide mid-apply (see wait_for_no_autosuspend_build).
  wait_for_no_autosuspend_build
  log "OpenTofu init + plan ($TF_DIR)"
  tofu_ init -backend-config="bucket=$STATE_BUCKET"
  # Heal state↔cloud drift a plain plan can't (untracked DB → import; legacy-purpose PSC
  # subnet → -replace). Runs after init (needs state); both branches self-disable once healed.
  reconcile_state
  # Apply exactly the reviewed plan. A bare `tofu apply` would refresh and create a
  # second plan after confirmation, allowing infrastructure drift between review and
  # mutation. The plan file is local, short-lived, and gitignored. Any reconcile -replace
  # targets are folded into THIS plan so the replacement is reviewed before it mutates GCP.
  # -lock-timeout: wait (don't instantly fail) if the lock is briefly held — covers the
  # residual window where an auto-suspend build starts just after the pre-check above cleared.
  tofu_ plan -lock-timeout=120s ${RECONCILE_REPLACE[@]+"${RECONCILE_REPLACE[@]}"} -out="$PLAN_FILE"
  if confirm "Apply this plan? (review the resource changes above)"; then
    if tofu_ apply -lock-timeout=120s "$PLAN_FILE"; then
      rm -f "$PLAN_FILE" "$TF_DIR/$PLAN_FILE"
    else
      # Saved plans contain sensitive values; remove it on failure as well as success.
      rm -f "$PLAN_FILE" "$TF_DIR/$PLAN_FILE"
      die "OpenTofu apply failed"
    fi
  else
    rm -f "$PLAN_FILE" "$TF_DIR/$PLAN_FILE"
    die "aborted before apply"
  fi
  # Only fetch kubectl creds when a cluster exists. When suspended, the
  # get_credentials_command output is a human-readable sentinel (not a gcloud command),
  # so guard against eval-ing it.
  local getcreds
  getcreds="$(tofu_ output -raw get_credentials_command)"
  if [[ "$getcreds" == gcloud* ]]; then
    log "Fetching kubectl credentials"
    eval "$getcreds"
    ok "kubeconfig points at the new cluster"
  else
    warn "no cluster (environment suspended) — skipping kubectl credential fetch"
  fi
}

# External Secrets Operator — required ONCE per cluster before any `kubectl apply -k`,
# because the gcp overlay ships SecretStore/ExternalSecret CRs whose CRDs ESO installs.
# Without it, CI's apply fails ("no matches for kind SecretStore") and pods never get
# their secrets. ESO authenticates via Workload Identity (no static key) — see
# external-secrets.yaml. Idempotent: `helm upgrade --install` + a CRD/rollout wait.
# NOTE: this function also calls reloader() at the end — `run.sh eso` installs both.
# Use `run.sh reloader` to reinstall Reloader alone without touching ESO.
eso() {
  log "Installing External Secrets Operator (idempotent)"
  use_cluster
  # Delegate the actual helm install to the SAME script CI runs (infra/ci/ensure-eso.sh) —
  # one source of truth for the chart, --version (from versions.env), the Autopilot 50m
  # --set block, and the failure policy (HELM_FAILURE_POLICY, overridden above for local
  # Helm). run.sh only adds the cluster-cred fetch above and the webhook wait below; the
  # install itself never diverges from CI again.
  infra/ci/ensure-eso.sh
  # Belt-and-suspenders: the chart's --wait covers the Deployments, but CR-admission
  # also needs the validating webhook live before the overlay's SecretStore is accepted.
  kubectl -n external-secrets rollout status deploy/external-secrets-webhook --timeout=3m
  ok "ESO installed; SecretStore/ExternalSecret CRDs available"

  reloader
}

# Stakater Reloader — required ONCE per cluster (also installed by CI on every deploy).
# Watches the devstash-secrets K8s Secret and rolls Deployment pods when ESO refreshes
# it from Secret Manager, so secret updates propagate without a manual rollout restart.
# Without Reloader the secret.reloader.stakater.com/reload annotation on the Deployment
# is inert and updated secrets only take effect on the next manual deploy.
# Idempotent: `helm upgrade --install` is a no-op when already at the pinned version.
# Pin the same version used in deploy-gke.yml to keep bootstrap and CI in sync.
reloader() {
  log "Installing Stakater Reloader (idempotent)"
  use_cluster
  # Same single-source-of-truth delegation as eso(): infra/ci/ensure-reloader.sh owns the
  # chart, --version, --set, and the failure policy (HELM_FAILURE_POLICY) shared with CI.
  infra/ci/ensure-reloader.sh
  ok "Stakater Reloader installed; Deployment auto-restarts on secret rotation"
}

# secrets: read Terraform outputs and write them as GitHub Actions secrets/variables.
# Sets GCP_PROJECT_ID, DEPLOYER_SA, WORKLOAD_IDENTITY_PROVIDER (secrets) and
# APP_DOMAIN (variable, non-secret). Verifies every value was accepted before returning.
# Must run after a successful `apply` so the tofu outputs exist.
secrets() {
  log "Pushing GitHub Actions secrets from tofu output"
  gh auth status >/dev/null 2>&1 || die "gh CLI not authenticated — run: gh auth login"
  gh secret set GCP_PROJECT_ID            --body "$(tofu_ output -raw gcp_project_id)"
  gh secret set DEPLOYER_SA               --body "$(tofu_ output -raw deployer_service_account_email)"
  gh secret set WORKLOAD_IDENTITY_PROVIDER --body "$(tofu_ output -raw wif_provider)"
  # APP_DOMAIN is a GitHub *variable* (non-secret public config), not a secret.
  # It is read by the CI workflow as ${{ vars.APP_DOMAIN }} and injected into
  # settings.yaml as the public domain for the ManagedCertificate and NEXTAUTH_URL.
  gh variable set APP_DOMAIN              --body "$(tofu_ output -raw app_domain)"
  gh variable set EMAIL_FROM              --body "$(tofu_ output -raw email_from)"
  gh variable set ENABLE_GITHUB_ATTESTATIONS --body "false"
  # Cloud Armor toggle — inject-settings.sh keys the BackendConfig securityPolicy on this.
  # true → CI attaches devstash-dev-armor; cleared (dev $0 default) → empty policy (no WAF).
  if [ "$(tf_out armor_enabled false)" = "true" ]; then
    gh variable set ARMOR_ENABLED --body "true"
  else
    gh variable delete ARMOR_ENABLED >/dev/null 2>&1 || true
  fi
  # Binary Authorization attestor/KMS resource names (non-secret) — read by the
  # "Sign images for Binary Authorization" CI step. See modules/gke/main.tf.
  # When binauthz_enabled=false these outputs are null (the pipeline is not provisioned);
  # `tofu output -raw` errors on null, so guard on a non-empty value. If disabled, DELETE
  # any stale vars so the CI step self-skips instead of signing against a gone attestor.
  local attestor
  attestor="$(tf_out binauthz_attestor_name)"
  if [ -n "$attestor" ]; then
    gh variable set BINAUTHZ_ATTESTOR       --body "$attestor"
    gh variable set BINAUTHZ_KMS_KEYRING    --body "$(tofu_ output -raw binauthz_kms_keyring)"
    gh variable set BINAUTHZ_KMS_KEY        --body "$(tofu_ output -raw binauthz_kms_key)"
    ok "GCP_PROJECT_ID / DEPLOYER_SA / WORKLOAD_IDENTITY_PROVIDER set as secrets; APP_DOMAIN / EMAIL_FROM / ENABLE_GITHUB_ATTESTATIONS / BINAUTHZ_* set as variables"
  else
    gh variable delete BINAUTHZ_ATTESTOR    >/dev/null 2>&1 || true
    gh variable delete BINAUTHZ_KMS_KEYRING >/dev/null 2>&1 || true
    gh variable delete BINAUTHZ_KMS_KEY     >/dev/null 2>&1 || true
    ok "GCP_PROJECT_ID / DEPLOYER_SA / WORKLOAD_IDENTITY_PROVIDER set as secrets; APP_DOMAIN / EMAIL_FROM / ENABLE_GITHUB_ATTESTATIONS set as variables (Binary Authorization disabled — BINAUTHZ_* cleared)"
  fi

  log "Verifying GitHub Actions secrets are present"
  # Use JSON output so column-aligned table text never causes a false miss.
  # NOTE: APP_DOMAIN is a variable (not a secret) — it is NOT verified here because
  # `gh secret list` only lists secrets. Verify it with: gh variable list
  local names missing=0
  names="$(gh secret list --json name -q '.[].name')"
  count_missing "$names" GCP_PROJECT_ID DEPLOYER_SA WORKLOAD_IDENTITY_PROVIDER || missing=$?
  [[ $missing -eq 0 ]] || die "$missing secret(s) not confirmed in GitHub — re-run 'secrets'"
  # Separately verify the variables — gh variable list exits 0 even if empty, so a
  # per-variable value fetch is the only reliable presence check.
  local gh_var gh_val
  # Always-present variables — a missing one is a real setup failure.
  for gh_var in APP_DOMAIN EMAIL_FROM ENABLE_GITHUB_ATTESTATIONS; do
    gh_val="$(gh variable list --json name,value -q ".[] | select(.name==\"$gh_var\") | .value" 2>/dev/null || true)"
    if [[ -z "$gh_val" ]]; then
      warn "$gh_var variable not found in GitHub — gh variable set may have failed; re-run 'secrets'"
    else
      ok "$gh_var variable = $gh_val"
    fi
  done
  # Optional feature toggles — absent by design in the dev $0 posture (Binary Authorization
  # off, Cloud Armor off), so report only when present rather than warning on absence.
  for gh_var in ARMOR_ENABLED BINAUTHZ_ATTESTOR BINAUTHZ_KMS_KEYRING BINAUTHZ_KMS_KEY; do
    gh_val="$(gh variable list --json name,value -q ".[] | select(.name==\"$gh_var\") | .value" 2>/dev/null || true)"
    [[ -n "$gh_val" ]] && ok "$gh_var variable = $gh_val"
  done
}

# dns_hint: print the DNS A-record the user must create after `apply`.
# The GCP-managed certificate won't provision until the domain resolves to the
# Ingress static IP; the app stays at 502/404 until the cert reaches Active status
# (up to 60 min after DNS propagates). Also reminds about Stripe webhook + OAuth URIs.
dns_hint() {
  local ip dom
  ip="$(tf_out ingress_ip_address)"
  dom="$(tf_out app_domain)"
  log "DNS — point your subdomain at the Ingress static IP, then the managed cert provisions"
  echo "  Add an A-record:  ${dom:-<app_domain>}  →  ${ip:-<run: tofu output ingress_ip_address>}"
  echo "  Verify:           dig +short ${dom:-<app_domain>}"
  echo "  Cert status:      kubectl -n $NS get managedcertificate devstash-cert -o wide"
  warn "Do NOT repoint the apex/www (those serve prod on Vercel) — use the subdomain only."
  warn "Also do §7c (Stripe webhook) + §7d (OAuth redirect URIs) in 08-gcp-bootstrap.md."
  warn "IMPORTANT: GCP-managed cert provisioning takes up to 60 min after DNS propagates."
  warn "The site will return 502/404 until the ManagedCertificate status is 'Active'."
  warn "Poll with: kubectl -n $NS get managedcertificate devstash-cert -o wide"
}

# deploy: dispatch the deploy-gke.yml GitHub Actions workflow via `gh workflow run`.
# The workflow builds the container, pushes to Artifact Registry, runs DB migrations,
# and rolls out the new image to GKE. Follow progress with `gh run watch`.
deploy() {
  log "Triggering the deploy-gke CI workflow (build web+migrate → push → apply -k → migrate Job → rollout)"
  gh workflow run deploy-gke.yml
  ok "dispatched — follow it with:  gh run watch"
}

# verify-secrets: list expected Secret Manager secrets and flag any that are missing.
# Useful after first bootstrap or after rotating a secret to confirm ESO has what it needs.
# All secrets must exist for ESO to materialise devstash-secrets and let pods start.
verify_secrets() {
  ensure_tfvars
  log "Verifying Secret Manager secrets for project $PROJECT_ID"
  use_cluster_soft "cluster not reachable — secrets check runs against Secret Manager only"

  # All app credentials live as JSON properties of ONE consolidated secret,
  # devstash-app-config (see modules/iam + external-secrets.yaml). These keys must always
  # be present regardless of suspend state; the conditional infra keys (database-*/redis-*)
  # exist only while the env is active and are reported informationally below.
  # Intentionally absent everywhere — non-secret config in the devstash-config ConfigMap
  # (settings.yaml), NOT Secret Manager: email-from (EMAIL_FROM), auth-github-id /
  # auth-google-id (OAuth client IDs), stripe-publishable-key, stripe-price-id-*,
  # uploads-bucket, s3-endpoint, s3-region.
  local expected=(
    "auth-secret" "auth-github-secret" "auth-google-secret"
    "resend-api-key" "stripe-secret-key" "stripe-webhook-secret" "openai-api-key"
    "s3-access-id" "s3-secret"
  )

  local blob keys
  blob="$(app_config_blob)"
  if [[ -z "$blob" ]]; then
    warn "consolidated secret devstash-app-config is missing or unreadable — pods cannot start"
    warn "Apply Terraform (run.sh apply) to create it, or see §7b of infra/docs/08-gcp-bootstrap.md"
    keys=""
  else
    # Keys only — values are never printed. Invalid JSON yields an empty key list → all missing.
    keys="$(printf '%s' "$blob" | jq -r 'keys[]' 2>/dev/null || true)"
  fi

  local missing=0
  count_missing "$keys" "${expected[@]}" || missing=$?

  if [[ $missing -gt 0 ]]; then
    warn "$missing required key(s) absent from devstash-app-config — pods will fail to start until all are present"
    warn "See §7b of infra/docs/08-gcp-bootstrap.md for how to add them"
  else
    ok "all $((${#expected[@]})) required keys present in devstash-app-config"
    # Report the active-only infra keys so an operator can tell active from suspended state.
    local infra_key present_infra=()
    for infra_key in database-url direct-url database-ca-cert redis-url redis-ca-cert; do
      printf '%s\n' "$keys" | grep -qxF "$infra_key" && present_infra+=("$infra_key")
    done
    if [[ ${#present_infra[@]} -gt 0 ]]; then
      log "active-only infra keys present: ${present_infra[*]}"
    else
      log "no infra keys (database-*/redis-*) present — consistent with a suspended environment"
    fi
  fi

  # Secret Manager presence ≠ K8s Secret existence. ESO must also sync them into the
  # cluster. Check the ExternalSecret Ready condition separately — a wrong key name,
  # missing IAM binding, or un-installed ESO will show secrets present in SM but
  # devstash-secrets K8s Secret missing (pods can't start until this is Ready=True).
  log "ESO sync status (requires cluster access)"
  if kubectl -n "$NS" get externalsecret devstash-secrets >/dev/null 2>&1; then
    local eso_ready
    eso_ready="$(kubectl -n "$NS" get externalsecret devstash-secrets \
      -o jsonpath='{.status.conditions[?(@.type=="Ready")].status}' 2>/dev/null || true)"
    if [[ "$eso_ready" == "True" ]]; then
      ok "ESO ExternalSecret Ready=True — devstash-secrets K8s Secret is synced"
    else
      warn "ESO ExternalSecret NOT Ready (status: ${eso_ready:-unknown}) — pods cannot start until sync completes"
      kubectl -n "$NS" describe externalsecret devstash-secrets 2>/dev/null || true
    fi
  else
    warn "ExternalSecret devstash-secrets not found — cluster not reachable or ESO not installed"
    warn "Run: bash infra/run/gcp/run.sh eso   (installs ESO + Reloader once per cluster)"
  fi
}

# rotate-secret: update a single Secret Manager secret and force ESO to sync immediately
# (skips the normal 1h refresh interval). Stakater Reloader then triggers a rolling
# restart of devstash-web so the new value is live within minutes — no manual `kubectl
# rollout restart` needed. Usage: run.sh rotate-secret <name-suffix>
# The value is read from a hidden prompt (or stdin) so it never appears in shell
# history or the process list.
rotate_secret() {
  local secret_name="${1:-}" new_value
  [[ -n "$secret_name" ]] || die "Usage: run.sh rotate-secret <name-suffix>"
  # Generated database/Redis/GCS values are Terraform-owned and must rotate through
  # their source resources. This command is only for operator-supplied credentials.
  case "$secret_name" in
    auth-secret|auth-github-secret|auth-google-secret|\
    resend-api-key|stripe-secret-key|stripe-webhook-secret|openai-api-key) ;;
    # NOTE: auth-github-id / auth-google-id / stripe-publishable-key / stripe-price-id-*
    # are NOT rotatable secrets — they are non-secret config in the devstash-config
    # ConfigMap (settings.yaml). Change them there (or the deploy-gke.yml override var).
    *) die "unsupported secret '$secret_name' — non-secret config lives in settings.yaml; generated database/Redis/GCS secrets rotate through OpenTofu" ;;
  esac
  if [[ -t 0 ]]; then
    read -r -s -p "New value for devstash-${secret_name}: " new_value
    printf '\n'
  else
    new_value="$(cat)"
  fi
  [[ -n "$new_value" ]] || die "secret value must not be empty"
  ensure_tfvars
  use_cluster "cluster not reachable — run 'apply' first"
  log "Rotating property ${secret_name} inside devstash-app-config"
  # Consolidated secret: read the JSON blob, replace ONE property, add a new version.
  # --arg keeps both the key name and the value out of the jq program text (no injection,
  # no shell-history/process-list exposure). The whole blob is piped, never echoed.
  local blob
  blob="$(app_config_blob)"
  [[ -n "$blob" ]] || die "devstash-app-config not found — run 'apply' first to create it"
  printf '%s' "$blob" \
    | jq --arg k "$secret_name" --arg v "$new_value" '.[$k] = $v' \
    | gcloud secrets versions add "devstash-app-config" --data-file=- --project="$PROJECT_ID"
  ok "Property ${secret_name} updated in devstash-app-config (new version)"
  log "Force ESO sync (skips the 1h refresh interval)"
  # Annotating the ExternalSecret with a fresh timestamp tells ESO to re-sync NOW.
  # Reloader watches the resulting K8s Secret and rolls the Deployment automatically.
  kubectl -n "$NS" annotate externalsecret devstash-secrets \
    force-sync="$(date +%s)" --overwrite
  ok "ESO sync triggered — Reloader will restart devstash-web once the Secret is updated"
  warn "Allow ~30s for ESO to pull from Secret Manager + Reloader to detect the change."
  warn "Also update third_party_secrets[\"$secret_name\"] in the gitignored terraform.tfvars so disaster recovery does not recreate the old value."
}

# upgrade-helm: bump ESO and Reloader to their latest published Helm chart versions.
# Checks `helm search repo` for each chart, updates infra/versions.env in-place, and
# re-installs both charts on the live cluster (via eso → infra/ci/ensure-*.sh). Safe to run
# at any time — `helm upgrade --install` is idempotent and the failure policy
# (HELM_FAILURE_POLICY) rolls the release back on failure.
#
# HOW IT WORKS:
#   1. Ensures both repos are registered and fresh (repo update).
#   2. Fetches the latest chart version for each using `helm search repo --output json`.
#   3. Compares against the current versions.env values — skips if already at latest.
#   4. Writes the new versions to versions.env (sed in-place).
#   5. Calls eso (reinstalls ESO + Reloader) so the live cluster matches.
upgrade_helm() {
  ensure_tfvars
  use_cluster

  log "Checking for Helm chart updates"
  helm_repo external-secrets https://charts.external-secrets.io
  helm_repo stakater https://stakater.github.io/stakater-charts

  local latest_eso latest_reloader
  latest_eso="$(helm search repo external-secrets/external-secrets --output json | jq -r '.[0].version')"
  latest_reloader="$(helm search repo stakater/reloader --output json | jq -r '.[0].version')"

  [[ -n "$latest_eso" ]]      || die "could not fetch latest ESO chart version"
  [[ -n "$latest_reloader" ]] || die "could not fetch latest Reloader chart version"

  local versions_file
  versions_file="$(dirname "$0")/../../versions.env"

  if [[ "$ESO_VERSION" == "$latest_eso" ]]; then
    ok "ESO already at latest ($ESO_VERSION)"
  else
    warn "ESO: $ESO_VERSION → $latest_eso (check release notes before upgrading)"
    if confirm "Upgrade ESO from $ESO_VERSION to $latest_eso?"; then
      sed -i.bak "s/^ESO_VERSION=.*/ESO_VERSION=$latest_eso/" "$versions_file" && rm -f "$versions_file.bak"
      ESO_VERSION="$latest_eso"
      ok "versions.env updated: ESO_VERSION=$latest_eso"
    fi
  fi

  if [[ "$RELOADER_VERSION" == "$latest_reloader" ]]; then
    ok "Reloader already at latest ($RELOADER_VERSION)"
  else
    warn "Reloader: $RELOADER_VERSION → $latest_reloader (check release notes before upgrading)"
    if confirm "Upgrade Reloader from $RELOADER_VERSION to $latest_reloader?"; then
      sed -i.bak "s/^RELOADER_VERSION=.*/RELOADER_VERSION=$latest_reloader/" "$versions_file" && rm -f "$versions_file.bak"
      RELOADER_VERSION="$latest_reloader"
      ok "versions.env updated: RELOADER_VERSION=$latest_reloader"
    fi
  fi

  log "Applying Helm chart versions to the cluster (eso + reloader)"
  eso
}

# _app_healthy <domain>: deep health check that passes ONLY when the JSON body reports
# status "ok". WHY jq -e (not plain curl -sf): `curl -sf` only checks the HTTP status (2xx),
# but the endpoint can return HTTP 200 with {"status":"error","db":"..."} when Cloud SQL
# isn't reachable yet (e.g. right after first deploy, before IAM propagation). `jq .` exits 0
# on any valid JSON, which would declare the app healthy while every DB op is broken. `jq -e`
# exits non-zero on a false/null result, so the poll keeps retrying until the body is ok.
_app_healthy() {
  curl -sf --max-time 10 "https://${1}/api/health?deep=1" | jq -e '.status == "ok"' >/dev/null
}
# smoke: wait for the latest CI workflow run to finish, then hit the health endpoint.
# Useful after 'deploy' to confirm the rollout completed successfully end-to-end.
smoke() {
  ensure_tfvars
  log "Waiting for the latest deploy-gke workflow run to finish"
  # Pin to the most recent deploy-gke.yml run so we don't accidentally watch a
  # different workflow that fired around the same time.
  local run_id
  run_id="$(gh run list --workflow deploy-gke.yml --limit 1 --json databaseId -q '.[0].databaseId')"
  [[ -n "$run_id" ]] || { warn "no deploy-gke workflow runs found"; return 1; }
  gh run watch "$run_id" --exit-status || { warn "CI workflow failed — check: gh run view $run_id"; return 1; }
  ok "CI run $run_id completed successfully"

  local domain
  domain="$(tf_out app_domain)"
  [[ -n "$domain" ]] || { warn "app_domain not set — run 'apply' first"; return 1; }

  log "Health check: https://${domain}/api/health?deep=1"
  if poll_until 12 10 -- _app_healthy "$domain"; then
    echo
    ok "app is healthy"
  else
    echo
    warn "health check timed out after 2 min — cert may still be provisioning"
    return 1
  fi
}

# status: print a quick health snapshot of the running environment.
# Shows workloads, pods, ESO sync state, managed TLS cert, Ingress IP, and the
# deep health endpoint. Useful to poll after `deploy` or `dns_hint` while waiting
# for the cert to become Active.
status() {
  log "Cluster status"
  use_cluster_soft

  echo
  log "Workloads"
  kubectl -n "$NS" get deploy,statefulset,job,managedcertificate,ingress 2>/dev/null || true

  echo
  log "Pods"
  kubectl -n "$NS" get pods -o wide 2>/dev/null || true

  echo
  log "ExternalSecrets (ESO sync)"
  kubectl -n "$NS" get externalsecret 2>/dev/null || warn "no externalsecrets (ESO not installed?)"

  echo
  log "Managed TLS certificate"
  kubectl -n "$NS" get managedcertificate devstash-cert -o wide 2>/dev/null \
    || warn "managed certificate not found — overlay not applied yet"
  warn "GCP-managed cert provisioning takes up to 60 min after DNS propagates."
  warn "The app will return 502/404 until the cert is Active — this is expected on first deploy."
  warn "Rerun 'status' to poll until 'Status: Active' appears."

  echo
  log "Infra"
  echo "  Ingress IP: $(tf_out ingress_ip_address '—')"
  echo "  App domain: $(tf_out app_domain '—')"

  echo
  log "App health (deep — requires pod to be running)"
  local domain
  domain="$(tf_out app_domain)"
  if [[ -n "$domain" ]]; then
    curl -sf --max-time 5 "https://${domain}/api/health?deep=1" | jq . 2>/dev/null \
      || warn "health endpoint unreachable (cert provisioning or app not up yet)"
  else
    warn "app_domain not available — run 'apply' first"
  fi
}

# logs: tail the last 100 log lines from all devstash-web pods simultaneously.
# Prefixes each line with the pod name so interleaved output is attributable.
logs() {
  use_cluster_soft
  kubectl -n "$NS" logs -l app.kubernetes.io/name=devstash --tail=100 --prefix --ignore-errors 2>/dev/null || true
}

# down: destroy the entire dev environment with `tofu destroy`.
# GKE and Cloud SQL are already unprotected in this env (they are torn down on every
# suspend cycle), so no deletion_protection dance is needed — destroy runs directly.
# The state bucket and GCP project are left intact after destroy.
down() {
  ensure_tfvars
  # A fresh checkout has no initialized backend even when the state bucket exists.
  # Use the same explicit backend selection as apply so destroy cannot read local or
  # wrong-environment state by accident.
  tofu_ init -backend-config="bucket=$STATE_BUCKET"
  log "Tear down — tofu destroy ($TF_DIR)"
  warn "This deletes the GKE cluster, Cloud SQL, and Memorystore."
  warn "The uploads + db-dumps GCS buckets will NOT be deleted if they contain objects"
  warn "(force_destroy is not set). This means the last Cloud SQL dump SURVIVES a 'down' —"
  warn "empty the bucket manually if you truly want everything gone:"
  warn "  gcloud storage rm -r gs://<bucket>/*"
  if confirm "Destroy the entire dev environment?"; then
    # The script already obtained explicit confirmation; avoid a second prompt that
    # makes AUTO_APPROVE=1 ineffective in automation.
    tofu_ destroy -auto-approve
    ok "destroyed. (State bucket gs://$STATE_BUCKET and the project are left intact.)"
  else
    die "aborted"
  fi
}

# ── suspend / resume (on-demand showcase) ───────────────────────────────────

# active.auto.tfvars is auto-loaded by OpenTofu (*.auto.tfvars) and is gitignored.
# Persisting the toggles here makes the suspended/active state STICKY: a plain
# `tofu apply` or `run.sh apply` keeps whatever state suspend/resume last set, instead
# of silently reverting to the defaults (active). suspend/resume write this file.
# $1 = environment_active (compute), $2 = db_active (Cloud SQL instance). Both lines are
# written together so they never drift out of sync.
set_active_state() {
  {
    printf 'environment_active = %s\n' "$1"
    printf 'db_active          = %s\n' "$2"
  } > "$TF_DIR/active.auto.tfvars"
}

# resolve_dump_target: read the three GCS-dump coordinates from tofu output and set the
# shared globals DUMP_INSTANCE + DUMP_URI. Returns non-zero (setting nothing) if any output
# is empty — the normal case for a not-yet-applied env. Callers decide the severity of that
# (dump_db dies, restore_db warns+skips), so the resolution logic lives here exactly once.
# db_dump_object is the single source of truth (locals.tf) shared with the auto-suspend path,
# so suspend writes and resume read the exact same GCS object.
resolve_dump_target() {
  local bucket object
  DUMP_INSTANCE="$(tf_out db_instance_name)"
  bucket="$(tf_out db_dumps_bucket)"
  object="$(tf_out db_dump_object)"
  [[ -n "$DUMP_INSTANCE" && -n "$bucket" && -n "$object" ]] || return 1
  DUMP_URI="gs://${bucket}/${object}"
}

# dump_db: server-side export of the live Cloud SQL DB to the GCS dump bucket, run BEFORE
# a deep suspend destroys the instance. `gcloud sql export` makes Cloud SQL's own service
# agent run pg_dump straight to GCS, so it works over the instance's private-only network
# (no public IP / laptop connectivity needed). Verifies the object is non-empty and ABORTS
# on any failure — suspend() must not destroy the instance unless this returns 0.
_sql_runnable() {
  [[ "$(gcloud sql instances describe "$1" --project="$PROJECT_ID" --format='value(state)' 2>/dev/null)" == "RUNNABLE" ]]
}
dump_db() {
  local state size
  ensure_tfvars
  resolve_dump_target || die "cannot resolve Cloud SQL instance / dump bucket / object from tofu output — run 'apply' first"

  # Must be RUNNABLE to export. If a prior compute-only suspend left it STOPPED
  # (activation_policy=NEVER), start it just long enough to dump; the apply that follows
  # destroys it anyway, so this transient start is harmless.
  state="$(gcloud sql instances describe "$DUMP_INSTANCE" --project="$PROJECT_ID" --format='value(state)' 2>/dev/null || true)"
  [[ -n "$state" ]] || die "Cloud SQL instance '$DUMP_INSTANCE' not found — nothing to dump (already deep-suspended?)"
  if [[ "$state" != "RUNNABLE" ]]; then
    warn "instance is '$state' — starting it to take a consistent dump"
    gcloud sql instances patch "$DUMP_INSTANCE" --project="$PROJECT_ID" --activation-policy=ALWAYS --quiet
    poll_until 30 10 -- _sql_runnable "$DUMP_INSTANCE" \
      || die "instance did not reach RUNNABLE in time — aborting suspend"
    echo
  fi

  log "Exporting Cloud SQL '$DUMP_INSTANCE' → $DUMP_URI (server-side pg_dump)"
  gcloud sql export sql "$DUMP_INSTANCE" "$DUMP_URI" --database="$DB_NAME" --project="$PROJECT_ID" \
    || die "gcloud sql export failed — NOT suspending (instance left intact)"

  # Verify the dump exists and is non-empty BEFORE the caller is allowed to destroy the
  # instance. This is the safety gate that replaces Cloud SQL deletion_protection.
  # SIBLING: the event-driven path duplicates this exact export+non-empty-size gate in
  # scripts/auto-suspend-dump.sh (different execution model — Cloud Build container — so it
  # can't be shared code). If you change the verification rule here, change it there too.
  size="$(gcloud storage objects describe "$DUMP_URI" --format='value(size)' 2>/dev/null || true)"
  [[ "$size" =~ ^[0-9]+$ && "$size" -gt 0 ]] || die "dump $DUMP_URI missing or empty (size='${size:-none}') — NOT suspending"
  ok "DB exported and verified ($((size / 1024)) KiB) — safe to destroy the instance"
}

# restore_db: import the latest GCS dump into the freshly-recreated Cloud SQL instance on
# resume. Best-effort: on a first-ever bring-up there is no dump, so it skips and lets the
# CI Prisma migrations create the schema. The dump includes the _prisma_migrations table,
# so when a dump IS restored the CI migrate step is a no-op.
restore_db() {
  ensure_tfvars
  resolve_dump_target || { warn "no instance / dump bucket / object resolved — skipping restore"; return 0; }
  if ! gcloud storage objects describe "$DUMP_URI" >/dev/null 2>&1; then
    warn "no dump at $DUMP_URI — fresh database; CI migrations will create the schema"
    return 0
  fi
  log "Importing $DUMP_URI → Cloud SQL '$DUMP_INSTANCE' (database $DB_NAME)"
  gcloud sql import sql "$DUMP_INSTANCE" "$DUMP_URI" --database="$DB_NAME" --project="$PROJECT_ID" --quiet \
    || die "gcloud sql import failed — the instance is up but empty; investigate before the app deploys"
  ok "DB restored from $DUMP_URI"
}

# spaceship_api: single Spaceship DNS API entrypoint — owns the host, auth headers, and the
# `|| true` (a transport error must stay non-fatal so DNS work never hard-fails a resume).
# Reads $key/$secret from the caller's scope (update_dns is the sole consumer).
#   GET             → echoes the response body
#   PUT/DELETE/...  → echoes the HTTP status code (-o /dev/null -w '%{http_code}')
spaceship_api() {
  local method="$1" path="$2" body="${3:-}"
  local url="https://spaceship.dev/api/v1/dns/records/${path}"
  local -a hdr=(-H "X-API-Key: ${key}" -H "X-API-Secret: ${secret}" -H 'Content-Type: application/json')
  if [[ "$method" == GET ]]; then
    curl -s -X GET "${hdr[@]}" "$url" || true
  else
    curl -s -o /dev/null -w '%{http_code}' -X "$method" "${hdr[@]}" "$url" ${body:+-d "$body"} || true
  fi
}

# update_dns: re-point the app's A-record at the current ingress IP via the Spaceship
# DNS API. Needed on resume because the ingress IP is released on suspend and a fresh
# one is allocated each resume. Best-effort: prints a manual hint if creds are missing.
# Credentials come from env (SPACESHIP_API_KEY / SPACESHIP_API_SECRET) or, failing that,
# the consolidated Secret Manager ops blob devstash-ops-config (see `set-dns-creds`).
#
# REPLACE, never append. Spaceship's PUT /dns/records upserts by (type,name) but ONLY
# within the API's own "External API Custom Group", and force:true silences the conflict
# checker rather than reconciling the zone — so any OTHER A-record for this host survives:
# a stale IP from a prior resume, or a duplicate created by hand in the "Default Record
# Group". Two live A-records for one host make resolvers round-robin onto the dead ingress
# IP (intermittent 502s) AND stall managed-cert provisioning, which needs the name to
# resolve consistently to the current ingress. So we mirror the Spaceship Terraform
# provider's contract — upsert the desired record, then DELETE every other A-record for the
# host — instead of blindly adding one.
update_dns() {
  local ip domain root sub key secret code existing prune del_code
  # INGRESS_IP override: re-assert DNS when the tofu output is unavailable (mid-migration,
  # inconsistent state, or a raw `tofu apply` that never surfaced the output). Read the live
  # value with:  kubectl -n devstash get ingress devstash-web -o jsonpath='{.status.loadBalancer.ingress[0].ip}'
  ip="${INGRESS_IP:-$(tf_out ingress_ip_address)}"
  if [[ -z "$ip" || "$ip" == "null" ]]; then
    warn "no ingress IP available (environment suspended?) — skipping DNS update"
    warn "Pass one explicitly:  INGRESS_IP=<ip> bash infra/run/gcp/run.sh update-dns"
    return 0
  fi
  domain="$(tf_out app_domain)"
  [[ -n "$domain" ]] || { warn "app_domain not set — skipping DNS update"; return 0; }
  # gke.devstash.one → registered domain "devstash.one" (API path) + host label "gke".
  # Assumes a single subdomain label; adjust if app_domain ever gains more.
  root="${domain#*.}"
  sub="${domain%%.*}"

  # Ops creds live consolidated in the devstash-ops-config JSON blob (spaceship-api-key /
  # spaceship-api-secret properties). Read the blob ONCE, then pull each property with jq —
  # env vars still win for a one-off override. `|| true` keeps a missing/suspended secret a
  # warn-and-skip, not a hard failure.
  local ops_blob
  ops_blob="$(gcloud secrets versions access latest --secret=devstash-ops-config --project="$PROJECT_ID" 2>/dev/null || true)"
  key="${SPACESHIP_API_KEY:-$(printf '%s' "$ops_blob" | jq -r '."spaceship-api-key" // empty' 2>/dev/null || true)}"
  secret="${SPACESHIP_API_SECRET:-$(printf '%s' "$ops_blob" | jq -r '."spaceship-api-secret" // empty' 2>/dev/null || true)}"
  if [[ -z "$key" || -z "$secret" ]]; then
    warn "Spaceship API creds not found (env SPACESHIP_API_KEY/SPACESHIP_API_SECRET or"
    warn "Secret Manager devstash-ops-config via 'run.sh set-dns-creds')."
    warn "Update the A-record manually:  $domain  →  $ip"
    return 0
  fi

  log "Updating Spaceship DNS A-record: $domain → $ip"
  # Desired-state payload — shared by the upsert (step 1) and re-assert (step 3) so the two
  # writes can never drift apart. Short TTL (300s) so the change is picked up quickly.
  local put_body="{\"force\":true,\"items\":[{\"type\":\"A\",\"name\":\"${sub}\",\"address\":\"${ip}\",\"ttl\":300}]}"
  # 1) Upsert the desired record FIRST so the host is never left without an A-record even
  #    if the prune below fails. force:true is still required — the stale record still
  #    exists at this point, so without it the conflict checker would reject the PUT.
  code="$(spaceship_api PUT "$root" "$put_body")"
  if [[ ! "$code" =~ ^2 ]]; then
    warn "Spaceship API returned HTTP ${code:-000} — set the A-record manually: $domain → $ip"
    return 0
  fi

  # 2) Prune every OTHER A-record for this host (any address != the new ingress IP). GET
  #    the zone, keep only host A-records whose address differs, and DELETE them so exactly
  #    one A-record for $sub remains. Best-effort: a prune miss must not fail the resume,
  #    but it is warned so the leftover can be removed by hand.
  existing="$(spaceship_api GET "${root}?take=500&skip=0")"
  prune="$(printf '%s' "$existing" \
    | jq -c --arg n "$sub" --arg ip "$ip" \
        '[.items[]? | select(.type == "A" and .name == $n and .address != $ip) | {type, name, address}]' \
    2>/dev/null || printf '[]')"
  if [[ -n "$prune" && "$prune" != "[]" ]]; then
    log "Pruning stale $sub A-record(s): $(printf '%s' "$prune" | jq -r 'map(.address) | join(", ")')"
    del_code="$(spaceship_api DELETE "$root" "$prune")"
    [[ "$del_code" =~ ^2 ]] \
      || warn "Spaceship prune returned HTTP ${del_code:-000} — remove leftover $sub A-record(s) manually (Default Record Group entries may not be API-deletable)."
    # 3) Re-assert the desired record LAST, so the final write is always the correct one.
    #    The prune DELETE payload targets (type,name,address); if Spaceship ever widened
    #    that match to (type,name) it would drop the good record with the stale ones,
    #    leaving the host pointing nowhere. This idempotent upsert guarantees the zone ends
    #    with exactly gke → the current ingress IP regardless of DELETE semantics. It does
    #    NOT speed propagation (TTL-bound) — it only guarantees correctness after the prune.
    code="$(spaceship_api PUT "$root" "$put_body")"
    [[ "$code" =~ ^2 ]] \
      || warn "Spaceship re-assert returned HTTP ${code:-000} — verify the A-record manually: $domain → $ip"
  fi

  ok "DNS A-record updated ($domain → $ip). Allow a few minutes for propagation + cert."
}

# set-dns-creds: store the Spaceship DNS API key + secret in Secret Manager so resume
# can fetch them without keeping them in shell history. Values are read from hidden
# prompts (or stdin) and never echoed. Re-run to rotate.
set_dns_creds() {
  ensure_tfvars
  local key secret
  if [[ -t 0 ]]; then
    read -r -s -p "Spaceship API key: " key; printf '\n'
    read -r -s -p "Spaceship API secret: " secret; printf '\n'
  else
    read -r key; read -r secret
  fi
  [[ -n "$key" && -n "$secret" ]] || die "both key and secret are required"
  log "Storing Spaceship DNS API creds in the consolidated devstash-ops-config secret (project $PROJECT_ID)"
  # Both creds live as properties of ONE JSON blob (matches the Terraform-managed
  # devstash-ops-config in envs/dev/dns.tf — see update_dns's reader). jq builds the object
  # so values with special characters are encoded correctly and never touch the process
  # arg list. Create the secret if absent, then add a new version. --replication-policy
  # matches the auto replication used elsewhere in this project.
  local name=devstash-ops-config blob
  blob="$(jq -nc --arg k "$key" --arg s "$secret" '{"spaceship-api-key":$k,"spaceship-api-secret":$s}')"
  gcloud secrets describe "$name" --project="$PROJECT_ID" >/dev/null 2>&1 \
    || gcloud secrets create "$name" --replication-policy=automatic --project="$PROJECT_ID"
  printf '%s' "$blob" | gcloud secrets versions add "$name" --data-file=- --project="$PROJECT_ID"
  ok "Spaceship DNS creds stored in devstash-ops-config. Rotate them in the Spaceship dashboard if they were ever shared in plaintext."
}

# suspend: drive the environment to true ~$0. DUMPS Cloud SQL to GCS and verifies the
# dump FIRST, then sets environment_active=false + db_active=false and applies — this
# destroys the GKE cluster, Memorystore, Cloud NAT, Cloud Armor, the ingress IP AND the
# Cloud SQL instance (no kept disk). The data lives only in the verified GCS dump; resume
# restores it. The dump-and-verify happens before any destroy, so a failed dump aborts the
# suspend with the instance fully intact.
# Delete the ENTIRE Artifact Registry repository (every image, version, tag, incl.
# :buildcache) so a deep-suspended env holds ZERO image storage AND no lingering repo — the
# last standing cost above the always-free tier. Safe: 'resume' runs a full-refresh apply
# that RECREATES the repo (TF-managed, ungated on environment_active), then CI rebuilds +
# repushes from source before the app is applied, and the Deployment pins images by the
# digest CI just produced. Best-effort — a delete miss (repo already gone) must not abort the
# suspend. Mirrors the unattended auto-suspend delete step
# (scripts/auto-suspend-delete-repo.sh); keep the two in sync.
delete_registry() {
  local repo
  # Prefer Terraform's own repository_id output (single source of truth — modules/artifact-
  # registry) so this never drifts from a repository_id rename. Fall back to the "devstash"
  # literal if the output isn't readable, e.g. state unavailable.
  repo="$(tf_out artifact_registry_url)"
  repo="${repo##*/}"                 # last path segment of region-docker.pkg.dev/project/repo
  [[ -n "$repo" ]] || repo="devstash"
  log "Deleting Artifact Registry repository ${repo} (all images + tags)"
  gcloud artifacts repositories delete "${repo}" \
    --location="$REGION" --quiet --project="$PROJECT_ID" \
    || warn "repository delete returned non-zero (likely already gone) — continuing"
}

suspend() {
  ensure_tfvars
  log "Deep-suspending environment → ~\$0 (compute + Cloud SQL DESTROYED; data kept in GCS dump)"
  warn "Cloud SQL is DUMPED to GCS and verified, then DESTROYED. 'resume' recreates + restores it."
  warn "DNS for $APP_DOMAIN will go stale until 'resume' (the ingress IP is released)."
  dump_db                       # export + verify BEFORE anything is destroyed — aborts on failure
  set_active_state false false  # compute off + Cloud SQL instance destroyed
  apply                         # plan → review → apply; the plan shows the destroys
  delete_registry               # delete the AR repo (resume recreates it, CI rebuilds) — after apply, off the destroy path
  ok "Suspended to ~\$0 (data safe in the GCS dump). Run 'resume' to bring it back."
}

# resume: bring the environment back from a deep-suspended state. Recreates compute AND
# the Cloud SQL instance, RESTORES the DB from the latest GCS dump, reinstalls the
# in-cluster operators (ESO + Reloader, gone with the old cluster), redeploys the app, and
# re-points DNS at the new ingress IP. Skips bootstrap (project/billing/state/APIs persist
# across a suspend). The restore runs after apply (instance is RUNNABLE) and before deploy,
# so the app + migrate Job see the restored schema + data.
resume() {
  ensure_tfvars
  log "Resuming environment (recreate compute + Cloud SQL, restore the dump). Takes several minutes."
  set_active_state true true
  apply
  restore_db   # import the GCS dump into the fresh instance BEFORE the app deploys
  wait_for_cluster
  eso
  log "Redeploying the app (build → migrate → rollout) via CI"
  deploy
  update_dns
  log "Resume kicked off. Next:"
  echo "  1. Watch the deploy:  gh run watch"
  echo "  2. bash infra/run/gcp/run.sh smoke   # wait for CI + health check"
  warn "A new managed cert re-provisions after DNS resolves to the new IP (up to ~60 min)."
  warn "Site stays reachable meanwhile via the pre-shared-cert fallback (mcrt-ac492906-...) in overlays/gcp/kustomization.yaml."
}

# ── dispatch ───────────────────────────────────────────────────────────────

case "$CMD" in
  up)
    preflight; bootstrap; apply
    wait_for_cluster
    # dns_hint prints the record; update_dns then asserts it automatically. On a
    # first-ever bring-up the Spaceship creds may not be stored yet — update_dns
    # warns and falls back to the printed hint, so the manual path still works.
    eso; secrets; dns_hint; update_dns
    log "Bootstrap + infra done. Next:"
    echo "  1. If the DNS A-record above was not set automatically (creds missing),"
    echo "     add it by hand, then wait for the cert to go Active."
    echo "  2. bash infra/run/gcp/run.sh verify-secrets  # confirm all SM secrets exist + ESO synced"
    echo "  3. bash infra/run/gcp/run.sh deploy          # build + migrate + roll out the app"
    echo "  4. bash infra/run/gcp/run.sh smoke           # wait for CI + verify health endpoint"
    ;;
  bootstrap)       preflight; bootstrap ;;
  # update_dns re-points the gke.* A-record at the current ingress IP. The IP is
  # released on suspend and re-allocated fresh on every bring-up, so DNS MUST be
  # re-asserted after each apply — not just on resume — or the site resolves to the
  # dead prior IP (TLS reset / 502) until the record is fixed by hand. update_dns is
  # self-guarding: it warns-and-prints a manual hint if creds/IP are missing, and it
  # only ever touches the gke A-record (prod Vercel/email records are never affected),
  # so it strictly supersedes the print-only dns_hint here.
  apply)           preflight; apply; wait_for_cluster; eso; secrets; dns_hint; update_dns ;;
  eso)             eso ;;
  reloader)        reloader ;;
  secrets)         secrets ;;
  verify-secrets)  verify_secrets ;;
  rotate-secret)   rotate_secret "${2:-}" ;;
  upgrade-helm)    upgrade_helm ;;
  deploy)          deploy ;;
  smoke)           smoke ;;
  status)          status ;;
  logs)            logs ;;
  suspend)         preflight; suspend ;;
  resume)          preflight; resume ;;
  dump-db)         dump_db ;;
  restore-db)      restore_db ;;
  update-dns)      ensure_tfvars; update_dns ;;
  set-dns-creds)   set_dns_creds ;;
  down)            down ;;
  *) die "unknown command '$CMD' — one of: up | bootstrap | apply | eso | reloader | secrets | verify-secrets | rotate-secret | upgrade-helm | deploy | smoke | status | logs | suspend | resume | dump-db | restore-db | update-dns | set-dns-creds | down" ;;
esac
