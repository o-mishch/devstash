# shellcheck shell=bash
# GCP bootstrap for the deploy tooling — everything that must exist in GCP *before* `tofu init`
# can run (auth → project → billing → ADC → state bucket → APIs). SOURCED by infra/run/gcp/run.sh
# (never executed) — it shares run.sh's shell scope, so the functions here rely on state the
# parent already established. Split out of run.sh purely to keep that orchestrator readable; this
# is organisational, not a standalone module.
#
# Depends on (provided by run.sh before this file is sourced):
#   globals   PROJECT_ID, REGION, ENVIRONMENT, STATE_BUCKET, STATE_LIFECYCLE
#   helpers   log/ok/warn/die (infra/lib/common.sh), ensure_tfvars
#
# Source-guard: sourcing twice is a harmless no-op.
[[ -n "${_DEVSTASH_GCP_BOOTSTRAP_SH:-}" ]] && return 0
_DEVSTASH_GCP_BOOTSTRAP_SH=1

# bootstrap: everything that must exist in GCP *before* `tofu init` can run, run in the
# order the chicken-and-egg dependencies demand: auth → project → billing → ADC → state
# bucket → APIs. Each _bootstrap_* step is idempotent (checks existence before acting), so
# re-running after a partial failure is safe. Split into one function per concern so this reads
# as a table of contents and each step is independently reviewable — the sequence IS the
# documentation.
bootstrap() {
  ensure_tfvars
  log "GCP bootstrap for project '$PROJECT_ID' (region $REGION)"
  _bootstrap_auth
  _bootstrap_project
  _bootstrap_billing
  _bootstrap_adc
  _bootstrap_state_bucket
  _bootstrap_apis
}

# _bootstrap_auth: ensure an active gcloud login, launching the interactive flow if none.
_bootstrap_auth() {
  gcloud auth list --filter=status:ACTIVE --format='value(account)' | grep -q . \
    || { warn "no active gcloud account — launching login"; gcloud auth login; }
  ok "gcloud authenticated"
}

# _bootstrap_project: create the (global-unique) project if it can't be described, then select it.
_bootstrap_project() {
  if gcloud projects describe "$PROJECT_ID" >/dev/null 2>&1; then
    ok "project exists"
  else
    log "Creating project $PROJECT_ID"
    gcloud projects create "$PROJECT_ID" --name="DevStash"
  fi
  gcloud config set project "$PROJECT_ID" >/dev/null
  ok "active project set"
}

# _bootstrap_billing: link a billing account — most APIs (and the $300 credit) require one. Uses
# BILLING_ACCOUNT if set, else the first open account; dies if none is available.
_bootstrap_billing() {
  if [[ "$(gcloud billing projects describe "$PROJECT_ID" --format='value(billingEnabled)' 2>/dev/null)" == "True" ]]; then
    ok "billing linked"
    return 0
  fi
  local acct="${BILLING_ACCOUNT:-}"
  [[ -n "$acct" ]] || acct="$(gcloud billing accounts list --filter=open=true --format='value(name)' | head -1)"
  [[ -n "$acct" ]] || die "no open billing account found — set BILLING_ACCOUNT=XXXXXX-XXXXXX-XXXXXX"
  log "Linking billing account $acct"
  gcloud billing projects link "$PROJECT_ID" --billing-account="$acct"
}

# _bootstrap_adc: ensure Application Default Credentials exist — the Terraform google provider reads them.
_bootstrap_adc() {
  if gcloud auth application-default print-access-token >/dev/null 2>&1; then
    ok "ADC present"
  else
    warn "no ADC — launching application-default login"
    gcloud auth application-default login
  fi
}

# _bootstrap_state_bucket: create (if absent) and harden the Terraform state bucket — a chicken-and-egg
# prerequisite that must exist before `tofu init` can initialise the remote backend.
# Single-region (not the US multi-region): lower cost, co-located with the rest of the stack.
# Location is IMMUTABLE — an existing bucket in a different location must be recreated + state
# migrated, not updated in place. Security props are reconciled even for a pre-existing bucket:
# existence alone does not prove versioning is on or that public-access paths are disabled. The
# lifecycle rule ($STATE_LIFECYCLE) keeps the 2 most recent noncurrent generations for rollback
# (3 total incl. the live state) and drops older ones regardless of age — ARCHIVED-only, so the
# LIVE state object is never touched — keeping the bucket a $0 residual.
_bootstrap_state_bucket() {
  if gcloud storage buckets describe "gs://$STATE_BUCKET" >/dev/null 2>&1; then
    ok "state bucket gs://$STATE_BUCKET exists"
  else
    log "Creating state bucket gs://$STATE_BUCKET (single-region $REGION)"
    gcloud storage buckets create "gs://$STATE_BUCKET" --location="$REGION"
  fi
  gcloud storage buckets update "gs://$STATE_BUCKET" \
    --uniform-bucket-level-access --public-access-prevention --versioning
  ok "state bucket has uniform access, public-access prevention, and versioning"
  gcloud storage buckets update "gs://$STATE_BUCKET" --lifecycle-file="$STATE_LIFECYCLE"
  ok "state bucket lifecycle: keep 2 noncurrent state versions (3 total), drop older regardless of age"
}

# _bootstrap_apis: pre-enable the required APIs. Terraform also does this via google_project_service,
# but pre-enabling here speeds up the first `tofu apply` by avoiding Terraform's per-API enable
# wait. Must stay in sync with the list in infra/terraform/envs/dev/main.tf. --project is
# explicit even though _bootstrap_project set it, because gcloud config is mutable across terminals.
_bootstrap_apis() {
  log "Enabling required APIs (idempotent)"
  gcloud services enable --project="$PROJECT_ID" \
    compute.googleapis.com container.googleapis.com \
    sqladmin.googleapis.com \
    certificatemanager.googleapis.com \
    artifactregistry.googleapis.com secretmanager.googleapis.com \
    iam.googleapis.com iamcredentials.googleapis.com sts.googleapis.com \
    servicenetworking.googleapis.com memorystore.googleapis.com \
    orgpolicy.googleapis.com \
    binaryauthorization.googleapis.com \
    containeranalysis.googleapis.com \
    cloudresourcemanager.googleapis.com
  ok "APIs enabled"
}
