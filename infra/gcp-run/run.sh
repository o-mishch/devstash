#!/usr/bin/env bash
# One-shot: stand up the full GCP deploy of DevStash on GKE Autopilot — the cloud
# analog of infra/k8s/local-run/run.sh. Idempotent: every step checks existence
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
#   bash infra/gcp-run/run.sh up             bootstrap → terraform apply → gh secrets → DNS hint
#   bash infra/gcp-run/run.sh bootstrap      project/billing/ADC/state-bucket/APIs only
#   bash infra/gcp-run/run.sh apply          terraform init + apply only
#   bash infra/gcp-run/run.sh eso            install External Secrets Operator (once per cluster)
#   bash infra/gcp-run/run.sh reloader       install Stakater Reloader (once per cluster)
#   bash infra/gcp-run/run.sh secrets        push GCP_PROJECT_ID/DEPLOYER_SA/WIF + APP_DOMAIN to GitHub
#   bash infra/gcp-run/run.sh verify-secrets check all expected Secret Manager secrets exist + ESO sync status
#   bash infra/gcp-run/run.sh rotate-secret  <name-suffix>   securely prompt for value + force ESO sync
#   bash infra/gcp-run/run.sh upgrade-helm   bump ESO + Reloader to latest chart versions + apply to cluster
#   bash infra/gcp-run/run.sh deploy         trigger the deploy-gke CI workflow (build+migrate+rollout)
#   bash infra/gcp-run/run.sh smoke          wait for latest CI run + health-check the app
#   bash infra/gcp-run/run.sh status         show cluster / ingress IP / cert / pod health
#   bash infra/gcp-run/run.sh logs           tail app pod logs (last 100 lines, all pods)
#   bash infra/gcp-run/run.sh down           tofu destroy (tear everything down)
#
# Env overrides (otherwise read from terraform.tfvars / auto-detected):
#   BILLING_ACCOUNT=XXXXXX-XXXXXX-XXXXXX   billing account to link (else first open one)
#   AUTO_APPROVE=1                         skip the confirmation before `tofu apply`/`destroy`
set -euo pipefail
cd "$(dirname "$0")/../.."   # repo root

TF_DIR=infra/terraform/envs/dev
TFVARS="$TF_DIR/terraform.tfvars"
STATE_BUCKET="${STATE_BUCKET:-}"
PLAN_FILE=devstash.tfplan
NS=devstash
CMD="${1:-up}"

# Pinned Helm chart versions — single source of truth shared with deploy-gke.yml.
# shellcheck source=../versions.env
source "$(dirname "$0")/../versions.env"

# ── helpers ────────────────────────────────────────────────────────────────
log()  { printf '\n\033[1;36m▶ %s\033[0m\n' "$*"; }
ok()   { printf '\033[0;32m  ✓ %s\033[0m\n' "$*"; }
warn() { printf '\033[0;33m  ! %s\033[0m\n' "$*"; }
die()  { printf '\033[0;31m✗ %s\033[0m\n' "$*" >&2; exit 1; }

need() { command -v "$1" >/dev/null 2>&1 || die "missing required CLI: $1 ($2)"; }

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
    log "Creating state bucket gs://$STATE_BUCKET"
    gcloud storage buckets create "gs://$STATE_BUCKET" --location=US
  fi
  # Reconcile security properties even for a pre-existing bucket. Existence alone
  # does not prove that state has object version recovery or that ACL/public access
  # paths are disabled.
  gcloud storage buckets update "gs://$STATE_BUCKET" \
    --uniform-bucket-level-access --public-access-prevention --versioning
  ok "state bucket has uniform access, public-access prevention, and versioning"

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
    servicenetworking.googleapis.com redis.googleapis.com \
    orgpolicy.googleapis.com \
    binaryauthorization.googleapis.com \
    containeranalysis.googleapis.com \
    cloudresourcemanager.googleapis.com
  ok "APIs enabled"
}

# apply: initialise the Terraform remote backend and run plan → apply.
# Requires the state bucket to exist (bootstrap must have run first).
# Always plans to a file and applies that exact plan so there is no drift between
# the reviewed diff and what actually mutates GCP. The plan file is gitignored and
# deleted after apply (success or failure) so no sensitive state lingers on disk.
apply() {
  ensure_tfvars
  # Guard: the GCS state bucket must exist before `tofu init` can initialise the
  # remote backend. If `bootstrap` was skipped, the init fails with a cryptic
  # "bucket not found" error. Check explicitly so the message is actionable.
  if ! gcloud storage buckets describe "gs://$STATE_BUCKET" >/dev/null 2>&1; then
    die "State bucket gs://$STATE_BUCKET not found — run 'bootstrap' first to create it."
  fi
  log "OpenTofu init + plan ($TF_DIR)"
  tofu_ init -backend-config="bucket=$STATE_BUCKET"
  # Apply exactly the reviewed plan. A bare `tofu apply` would refresh and create a
  # second plan after confirmation, allowing infrastructure drift between review and
  # mutation. The plan file is local, short-lived, and gitignored.
  tofu_ plan -out="$PLAN_FILE"
  if confirm "Apply this plan? (creates billable GKE Autopilot + Memorystore)"; then
    if tofu_ apply "$PLAN_FILE"; then
      rm -f "$TF_DIR/$PLAN_FILE"
    else
      # Saved plans contain sensitive values; remove it on failure as well as success.
      rm -f "$TF_DIR/$PLAN_FILE"
      die "OpenTofu apply failed"
    fi
  else
    rm -f "$TF_DIR/$PLAN_FILE"
    die "aborted before apply"
  fi
  log "Fetching kubectl credentials"
  eval "$(tofu_ output -raw get_credentials_command)"
  ok "kubeconfig points at the new cluster"
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
  eval "$(tofu_ output -raw get_credentials_command)" 2>/dev/null \
    || die "no cluster yet — run 'apply' first"
  # ESO_VERSION is sourced from infra/versions.env (same value CI uses).
  # Changing the version must be done in that file — both run.sh and CI read it.
  helm repo add external-secrets https://charts.external-secrets.io >/dev/null 2>&1 || true
  helm repo update external-secrets >/dev/null
  # --rollback-on-failure: roll back the helm release if the --wait timeout
  # expires, so a failed ESO upgrade never leaves the cluster in a half-upgraded
  # state. Replaces the deprecated --atomic flag (removed in Helm 4).
  # Consistent with the Reloader install below and CI (deploy-gke.yml).
  #
  # Resource requests are set explicitly to meet GKE Autopilot's per-container
  # minimum of 50m CPU (bursting nodes). The ESO chart defaults to 10m, which
  # Autopilot silently mutates upward — causing a noisy deprecation warning on
  # every install. Setting 50m here matches the Autopilot floor exactly and keeps
  # the rendered pod spec identical to what Autopilot would produce anyway.
  helm upgrade --install external-secrets external-secrets/external-secrets \
    --version "$ESO_VERSION" \
    -n external-secrets --create-namespace --wait --timeout 5m --rollback-on-failure \
    --set resources.requests.cpu=50m \
    --set resources.requests.memory=128Mi \
    --set certController.resources.requests.cpu=50m \
    --set certController.resources.requests.memory=128Mi \
    --set webhook.resources.requests.cpu=50m \
    --set webhook.resources.requests.memory=128Mi
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
  eval "$(tofu_ output -raw get_credentials_command)" 2>/dev/null \
    || die "no cluster yet — run 'apply' first"
  # RELOADER_VERSION is sourced from infra/versions.env (same value CI uses).
  helm repo add stakater https://stakater.github.io/stakater-charts >/dev/null 2>&1 || true
  helm repo update stakater >/dev/null
  # Resource requests set to Autopilot's 50m CPU floor (same rationale as ESO above).
  helm upgrade --install reloader stakater/reloader \
    --version "$RELOADER_VERSION" \
    -n reloader --create-namespace --wait --timeout 5m --rollback-on-failure \
    --set reloader.deployment.resources.requests.cpu=50m \
    --set reloader.deployment.resources.requests.memory=128Mi
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
  # Binary Authorization attestor/KMS resource names (non-secret) — read by the
  # "Sign images for Binary Authorization" CI step. See modules/gke/main.tf.
  gh variable set BINAUTHZ_ATTESTOR       --body "$(tofu_ output -raw binauthz_attestor_name)"
  gh variable set BINAUTHZ_KMS_KEYRING    --body "$(tofu_ output -raw binauthz_kms_keyring)"
  gh variable set BINAUTHZ_KMS_KEY        --body "$(tofu_ output -raw binauthz_kms_key)"
  ok "GCP_PROJECT_ID / DEPLOYER_SA / WORKLOAD_IDENTITY_PROVIDER set as secrets; APP_DOMAIN / EMAIL_FROM / ENABLE_GITHUB_ATTESTATIONS / BINAUTHZ_* set as variables"

  log "Verifying GitHub Actions secrets are present"
  # Use JSON output so column-aligned table text never causes a false miss.
  # NOTE: APP_DOMAIN is a variable (not a secret) — it is NOT verified here because
  # `gh secret list` only lists secrets. Verify it with: gh variable list
  local names
  names="$(gh secret list --json name -q '.[].name')"
  local missing=0
  for secret in GCP_PROJECT_ID DEPLOYER_SA WORKLOAD_IDENTITY_PROVIDER; do
    if echo "$names" | grep -qx "$secret"; then
      ok "$secret"
    else
      warn "MISSING: $secret — gh secret set may have failed"
      missing=$((missing + 1))
    fi
  done
  [[ $missing -eq 0 ]] || die "$missing secret(s) not confirmed in GitHub — re-run 'secrets'"
  # Separately verify the variables — gh variable list exits 0 even if empty.
  local app_dom_val email_from_val attest_val
  app_dom_val="$(gh variable list --json name,value -q '.[] | select(.name=="APP_DOMAIN") | .value' 2>/dev/null || true)"
  email_from_val="$(gh variable list --json name,value -q '.[] | select(.name=="EMAIL_FROM") | .value' 2>/dev/null || true)"
  attest_val="$(gh variable list --json name,value -q '.[] | select(.name=="ENABLE_GITHUB_ATTESTATIONS") | .value' 2>/dev/null || true)"
  if [[ -z "$app_dom_val" ]]; then
    warn "APP_DOMAIN variable not found in GitHub — gh variable set may have failed; re-run 'secrets'"
  else
    ok "APP_DOMAIN variable = $app_dom_val"
  fi
  if [[ -z "$email_from_val" ]]; then
    warn "EMAIL_FROM variable not found in GitHub — gh variable set may have failed; re-run 'secrets'"
  else
    ok "EMAIL_FROM variable = $email_from_val"
  fi
  if [[ -z "$attest_val" ]]; then
    warn "ENABLE_GITHUB_ATTESTATIONS variable not found in GitHub — gh variable set may have failed; re-run 'secrets'"
  else
    ok "ENABLE_GITHUB_ATTESTATIONS variable = $attest_val"
  fi
  local binauthz_var binauthz_val
  for binauthz_var in BINAUTHZ_ATTESTOR BINAUTHZ_KMS_KEYRING BINAUTHZ_KMS_KEY; do
    binauthz_val="$(gh variable list --json name,value -q ".[] | select(.name==\"$binauthz_var\") | .value" 2>/dev/null || true)"
    if [[ -z "$binauthz_val" ]]; then
      warn "$binauthz_var variable not found in GitHub — gh variable set may have failed; re-run 'secrets'"
    else
      ok "$binauthz_var variable = $binauthz_val"
    fi
  done
}

# dns_hint: print the DNS A-record the user must create after `apply`.
# The GCP-managed certificate won't provision until the domain resolves to the
# Ingress static IP; the app stays at 502/404 until the cert reaches Active status
# (up to 60 min after DNS propagates). Also reminds about Stripe webhook + OAuth URIs.
dns_hint() {
  local ip dom
  ip="$(tofu_ output -raw ingress_ip_address 2>/dev/null || true)"
  dom="$(tofu_ output -raw app_domain 2>/dev/null || true)"
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
  eval "$(tofu_ output -raw get_credentials_command)" 2>/dev/null || warn "cluster not reachable — secrets check runs against Secret Manager only"

  local expected=(
    "devstash-auth-secret"
    "devstash-auth-github-id" "devstash-auth-github-secret"
    "devstash-auth-google-id" "devstash-auth-google-secret"
    "devstash-resend-api-key"
    # devstash-email-from intentionally absent: EMAIL_FROM is a non-secret constant
    # stored in the devstash-config ConfigMap (kustomization.yaml), not Secret Manager.
    "devstash-stripe-secret-key" "devstash-stripe-publishable-key"
    "devstash-stripe-webhook-secret"
    "devstash-stripe-price-id-monthly" "devstash-stripe-price-id-yearly"
    "devstash-openai-api-key"
    "devstash-database-url" "devstash-direct-url" "devstash-database-ca-cert"
    "devstash-redis-url" "devstash-redis-ca-cert"
    "devstash-uploads-bucket"
    "devstash-s3-endpoint" "devstash-s3-region"
    "devstash-s3-access-id" "devstash-s3-secret"
  )

  local existing
  # name.basename() returns the short secret name regardless of whether gcloud
  # outputs a full resource path or just the name — no regex fragility.
  existing="$(gcloud secrets list --project="$PROJECT_ID" --format='value(name.basename())' 2>/dev/null || true)"

  local missing=0
  for secret in "${expected[@]}"; do
    if echo "$existing" | grep -qx "$secret"; then
      ok "$secret"
    else
      warn "MISSING: $secret"
      missing=$((missing + 1))
    fi
  done

  if [[ $missing -gt 0 ]]; then
    warn "$missing secret(s) missing — pods will fail to start until all are present"
    warn "See §7b of infra/docs/08-gcp-bootstrap.md for how to add them"
  else
    ok "all $((${#expected[@]})) expected secrets are present"
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
    warn "Run: bash infra/gcp-run/run.sh eso   (installs ESO + Reloader once per cluster)"
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
    auth-secret|auth-github-id|auth-github-secret|auth-google-id|auth-google-secret|\
    resend-api-key|stripe-secret-key|stripe-publishable-key|\
    stripe-webhook-secret|stripe-price-id-monthly|stripe-price-id-yearly|openai-api-key) ;;
    *) die "unsupported secret '$secret_name' — generated database/Redis/GCS secrets must rotate through OpenTofu" ;;
  esac
  if [[ -t 0 ]]; then
    read -r -s -p "New value for devstash-${secret_name}: " new_value
    printf '\n'
  else
    new_value="$(cat)"
  fi
  [[ -n "$new_value" ]] || die "secret value must not be empty"
  ensure_tfvars
  eval "$(tofu_ output -raw get_credentials_command)" 2>/dev/null \
    || die "cluster not reachable — run 'apply' first"
  log "Rotating secret devstash-${secret_name}"
  printf '%s' "$new_value" | gcloud secrets versions add "devstash-${secret_name}" \
    --data-file=- --project="$PROJECT_ID"
  ok "Secret devstash-${secret_name} updated in Secret Manager"
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
# re-installs both charts on the live cluster. Safe to run at any time — `helm upgrade
# --install` is idempotent and --rollback-on-failure rolls back on failure.
#
# HOW IT WORKS:
#   1. Ensures both repos are registered and fresh (repo update).
#   2. Fetches the latest chart version for each using `helm search repo --output json`.
#   3. Compares against the current versions.env values — skips if already at latest.
#   4. Writes the new versions to versions.env (sed in-place).
#   5. Calls eso (reinstalls ESO + Reloader) so the live cluster matches.
upgrade_helm() {
  ensure_tfvars
  eval "$(tofu_ output -raw get_credentials_command)" 2>/dev/null \
    || die "no cluster yet — run 'apply' first"

  log "Checking for Helm chart updates"
  helm repo add external-secrets https://charts.external-secrets.io >/dev/null 2>&1 || true
  helm repo add stakater https://stakater.github.io/stakater-charts >/dev/null 2>&1 || true
  helm repo update external-secrets stakater >/dev/null

  local latest_eso latest_reloader
  latest_eso="$(helm search repo external-secrets/external-secrets --output json | jq -r '.[0].version')"
  latest_reloader="$(helm search repo stakater/reloader --output json | jq -r '.[0].version')"

  [[ -n "$latest_eso" ]]      || die "could not fetch latest ESO chart version"
  [[ -n "$latest_reloader" ]] || die "could not fetch latest Reloader chart version"

  local versions_file
  versions_file="$(dirname "$0")/../versions.env"

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
  domain="$(tofu_ output -raw app_domain 2>/dev/null || true)"
  [[ -n "$domain" ]] || { warn "app_domain not set — run 'apply' first"; return 1; }

  log "Health check: https://${domain}/api/health?deep=1"
  local i=0
  # WHY jq -e '.status == "ok"': `curl -sf` only checks the HTTP status code (2xx).
  # The health endpoint can return HTTP 200 with {"status":"error","db":"..."} when
  # Cloud SQL isn't reachable yet (e.g. immediately after first deploy before IAM
  # propagation completes). `jq .` always exits 0 on valid JSON, so that would
  # declare the app healthy while every DB operation is broken.
  # `-e` makes jq exit non-zero when the filter result is false/null — which correctly
  # keeps the retry loop running until the body reports {"status":"ok",...}.
  until curl -sf --max-time 10 "https://${domain}/api/health?deep=1" \
      | jq -e '.status == "ok"' > /dev/null; do
    i=$((i + 1))
    [[ $i -lt 12 ]] || { warn "health check timed out after 2 min — cert may still be provisioning"; return 1; }
    printf '.'
    sleep 10
  done
  ok "app is healthy"
}

# status: print a quick health snapshot of the running environment.
# Shows workloads, pods, ESO sync state, managed TLS cert, Ingress IP, and the
# deep health endpoint. Useful to poll after `deploy` or `dns_hint` while waiting
# for the cert to become Active.
status() {
  log "Cluster status"
  eval "$(tofu_ output -raw get_credentials_command)" 2>/dev/null || warn "no cluster yet"

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
  echo "  Ingress IP: $(tofu_ output -raw ingress_ip_address 2>/dev/null || echo '—')"
  echo "  App domain: $(tofu_ output -raw app_domain 2>/dev/null || echo '—')"

  echo
  log "App health (deep — requires pod to be running)"
  local domain
  domain="$(tofu_ output -raw app_domain 2>/dev/null || true)"
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
  eval "$(tofu_ output -raw get_credentials_command)" 2>/dev/null || warn "no cluster yet"
  kubectl -n "$NS" logs -l app.kubernetes.io/name=devstash --tail=100 --prefix --ignore-errors 2>/dev/null || true
}

# down: destroy the entire dev environment with `tofu destroy`.
# GKE and Cloud SQL have deletion_protection=true by default — destroy will fail
# until that flag is set to false and applied first (instructions printed by the
# function). The state bucket and GCP project are left intact after destroy.
down() {
  ensure_tfvars
  # A fresh checkout has no initialized backend even when the state bucket exists.
  # Use the same explicit backend selection as apply so destroy cannot read local or
  # wrong-environment state by accident.
  tofu_ init -backend-config="bucket=$STATE_BUCKET"
  log "Tear down — tofu destroy ($TF_DIR)"
  warn "This deletes the GKE cluster, Cloud SQL, and Memorystore."
  warn "The GCS bucket will NOT be deleted if it contains objects (force_destroy is not set)."
  warn "To destroy the bucket, empty it first: gcloud storage rm -r gs://<bucket>/*"
  warn ""
  warn "IMPORTANT: deletion_protection defaults true for both GKE and Cloud SQL."
  warn "Destroy will fail until false has been applied into state:"
  warn "  1. Set deletion_protection = false in the gitignored terraform.tfvars"
  warn "  2. Run: bash infra/gcp-run/run.sh apply  (review the saved plan)"
  warn "  3. Re-run: bash infra/gcp-run/run.sh down"
  if confirm "Destroy the entire dev environment? (deletion_protection must be false first)"; then
    # The script already obtained explicit confirmation; avoid a second prompt that
    # makes AUTO_APPROVE=1 ineffective in automation.
    tofu_ destroy -auto-approve
    ok "destroyed. (State bucket gs://$STATE_BUCKET and the project are left intact.)"
  else
    die "aborted"
  fi
}

# ── dispatch ───────────────────────────────────────────────────────────────

# wait_for_cluster: poll `kubectl cluster-info` until the GKE Autopilot control
# plane responds (typically 5-7 min after `tofu apply` completes). Times out after
# 10 minutes with an actionable error pointing to the GCP console.
wait_for_cluster() {
  log "Waiting for GKE cluster control plane to become reachable (Autopilot takes 5-7 min)"
  local i=0
  until kubectl cluster-info >/dev/null 2>&1; do
    i=$((i + 1))
    [[ $i -lt 60 ]] || die "Cluster not reachable after 10 minutes — check GCP console"
    printf '.'
    sleep 10
  done
  echo
  ok "cluster reachable"
}

case "$CMD" in
  up)
    preflight; bootstrap; apply
    wait_for_cluster
    eso; secrets; dns_hint
    log "Bootstrap + infra done. Next:"
    echo "  1. Add the DNS A-record above and wait for the cert to go Active."
    echo "  2. bash infra/gcp-run/run.sh verify-secrets  # confirm all SM secrets exist + ESO synced"
    echo "  3. bash infra/gcp-run/run.sh deploy          # build + migrate + roll out the app"
    echo "  4. bash infra/gcp-run/run.sh smoke           # wait for CI + verify health endpoint"
    ;;
  bootstrap)       preflight; bootstrap ;;
  apply)           preflight; apply; wait_for_cluster; eso; secrets; dns_hint ;;
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
  down)            down ;;
  *) die "unknown command '$CMD' — one of: up | bootstrap | apply | eso | reloader | secrets | verify-secrets | rotate-secret | upgrade-helm | deploy | smoke | status | logs | down" ;;
esac
