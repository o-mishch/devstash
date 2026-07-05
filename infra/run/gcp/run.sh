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
#   does the SAME deep suspend unattended: it too dumps + verifies FIRST, then applies
#   environment_active=false + db_active=false — so it also DESTROYS the Cloud SQL instance
#   (not merely stops it), and resume recreates + restores it. The dump-verify gate (a
#   separate Cloud Build step before the destroy) is what makes that unattended destroy safe.
#
# Env overrides (otherwise read from terraform.tfvars / auto-detected):
#   BILLING_ACCOUNT=XXXXXX-XXXXXX-XXXXXX   billing account to link (else first open one)
#   AUTO_APPROVE=1                         skip the confirmation before `tofu apply`/`destroy`
set -euo pipefail
# Fail LOUD, never silently. Under `set -e` any un-guarded non-zero command aborts the whole
# script — historically with NO message (e.g. a reconcile gcloud call fed a bad arg would exit
# 1 right after `tofu init`, leaving "up complete, nothing created" with no clue why). This ERR
# trap turns every such death into an actionable report: the exact failing command, its exit
# code, and the file:line — printed to stderr before the shell exits. `die` (explicit, message-
# bearing exits from common.sh) uses exit code 1 too, but those already print their own message
# and reason; the trap's extra one line is harmless there and invaluable everywhere else. Self-
# contained (raw ANSI, bash builtins only) so it works even before common.sh is sourced below.
# shellcheck disable=SC2154  # rc IS assigned (rc=$?) and used ("$rc") within this trap string; shellcheck can't see across the trap boundary.
trap 'rc=$?; printf "\n\033[0;31m✖ run.sh FAILED\033[0m — %s:%d\n    command: %s\n    exit code: %d\n" "${BASH_SOURCE[0]}" "$LINENO" "$BASH_COMMAND" "$rc" >&2' ERR
cd "$(dirname "${BASH_SOURCE[0]}")/../../.."   # repo root

TF_DIR=infra/terraform/envs/dev
TFVARS="$TF_DIR/terraform.tfvars"
STATE_BUCKET="${STATE_BUCKET:-}"
# GCS lifecycle config for the out-of-band state bucket. Kept as a standalone JSON file
# (not an inline heredoc) so it is diffable, jq-validatable, and reviewable as JSON.
STATE_LIFECYCLE=infra/run/gcp/tfstate-lifecycle.json
# Synchronous version cap enforced after every state write (see gcs_prune_versions in
# infra/lib/common.sh). "3 total" = the live state + 2 noncurrent, matching the lifecycle
# rule in $STATE_LIFECYCLE (numNewerVersions=2) — the two mechanisms deliberately agree, one
# immediate, one async-backstop. State keys live under the backend prefix "gke/dev".
STATE_KEEP_VERSIONS=3
STATE_PREFIX="gke/dev/"
# How long apply() holds the provisioning marker past a SUCCESSFUL tofu apply, to cover GCP IAM
# eventual consistency — see the sleep call site in apply() for the incident this closes.
IAM_PROPAGATION_COOLDOWN=120
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
source "$(dirname "${BASH_SOURCE[0]}")/../../versions.env"
# Shared image coordinates (DEVSTASH_IMAGES, ds_image_base) — the same helpers the CI
# scripts source, so run.sh and infra/ci/*.sh never drift on the registry path.
# shellcheck source=../../lib/common.sh
source "$(dirname "${BASH_SOURCE[0]}")/../../lib/common.sh"

# Cohesive step clusters split into sourced sub-libraries beside this file, purely to keep this
# orchestrator readable. They SHARE this shell's scope (globals + helpers defined above and
# below), so this is organisational, not a decoupling. Bash resolves function names at CALL time,
# so a lib may call helpers/globals defined later in run.sh — the only hard requirement is that
# everything exists before the dispatch case at the bottom invokes anything. bootstrap.sh,
# reconcile.sh, and gke.sh are leaf clusters (only depend on common.sh + run.sh globals).
# suspend.sh comes last only for readability: its suspend/resume call into db.sh
# (dump_db/restore_db), dns.sh (update_dns) AND run.sh/gke.sh core steps (apply/eso/deploy/
# wait_for_cluster).
# shellcheck source=lib/bootstrap.sh
source "$(dirname "${BASH_SOURCE[0]}")/lib/bootstrap.sh"
# shellcheck source=lib/reconcile.sh
source "$(dirname "${BASH_SOURCE[0]}")/lib/reconcile.sh"
# shellcheck source=lib/gke.sh
source "$(dirname "${BASH_SOURCE[0]}")/lib/gke.sh"
# shellcheck source=lib/db.sh
source "$(dirname "${BASH_SOURCE[0]}")/lib/db.sh"
# shellcheck source=lib/dns.sh
source "$(dirname "${BASH_SOURCE[0]}")/lib/dns.sh"
# shellcheck source=lib/suspend.sh
source "$(dirname "${BASH_SOURCE[0]}")/lib/suspend.sh"

# ── helpers ────────────────────────────────────────────────────────────────
# log/ok/warn/die/need + confirm/poll_until/count_missing are provided by the sourced
# infra/lib/common.sh (shared with infra/run/local/run.sh so both orchestrators speak one
# logging/preflight/CLI-plumbing vocabulary).

# Read a scalar from terraform.tfvars (single source of truth for project/region). Runs BEFORE
# `tofu init`, so `tofu output/console` is not yet an option — a line-oriented read is the only
# tool available this early. Scoped by design: it handles the simple quoted scalars this script
# scaffolds from tfvars.example (project_id/region/environment/app_domain), NOT arbitrary HCL
# (heredocs, multi-line lists, or `=` inside a value). $1 is interpolated into the regex, so
# call it only with literal key names (all current callers do) — never with user input.
tfvar() {
  [[ -f "$TFVARS" ]] || return 1
  grep -E "^[[:space:]]*$1[[:space:]]*=" "$TFVARS" | head -1 \
    | sed -E 's/^[^=]*=[[:space:]]*"?([^"#]*[^"# ])"?.*$/\1/'
}

tofu_() { tofu -chdir="$TF_DIR" "$@"; }

# tf_out <output-name> [fallback]: soft-read a tofu output, returning [fallback] (default
# empty) when the output is absent — the normal case for a suspended or not-yet-applied env.
# Centralises the soft-read so call sites read as intent, not incantation. Use plain
# `tofu_ output -raw` (NOT this) where a missing output must fail loudly (e.g. pushing
# required GitHub secrets).
#
# WHY -json, not -raw: on a state with NO outputs (fresh/destroyed env) `tofu output -raw X`
# prints its "No outputs found" WARNING BOX to STDOUT (not stderr) and still exits 0 — a
# long-standing terraform bug (hashicorp/terraform#26991). So the old `-raw 2>/dev/null ||
# fallback` returned that multi-line box AS the value (2>/dev/null can't catch a stdout
# warning, and the `||` never fires on exit 0). Callers then fed the garbage to gcloud
# (e.g. `--instance=╷…`), which failed and — under `set -e` — killed the whole run silently.
# `tofu output -json` instead prints `{}` on empty state (no warning box), so jq cleanly
# yields the fallback. jq is a preflight-required CLI. Missing key OR json null → fallback.
tf_out() {
  local json
  json="$(tofu_ output -json 2>/dev/null)" || json='{}'
  printf '%s' "$json" \
    | jq -r --arg k "$1" --arg fb "${2:-}" '(.[$k]?.value // $fb) | tostring' 2>/dev/null \
    || printf '%s' "${2:-}"
}

# require_outputs <output-name>...: die unless EVERY named tofu output is present and non-empty.
# MUST be called as a bare statement in the caller's shell (not inside `$(…)`) — that is the whole
# point: a `die` (exit 1) inside a command substitution only kills the subshell, so bash then runs
# the outer command (`gh secret set … --body ""`) with an EMPTY body and `gh` drops into an
# interactive "Paste your secret:" prompt — the failure never propagates. Gating up front, in the
# parent shell, means one missing output aborts `secrets` before any `gh` call runs.
#
# Guards the same class of outputs that must exist (unconditional passthroughs like app_domain /
# email_from / gcp_project_id): on an empty-output state (fresh / not-yet-applied / suspended) the
# old `tofu_ output -raw X` printed the #26991 "No outputs found" WARNING BOX to STDOUT and exited
# 0, so the box was written verbatim into the GitHub secret/variable (see the tf_out comment above).
# Reading through the -json path (via tf_out) can't emit that box; this gate then rejects emptiness.
require_outputs() {
  local name missing=()
  for name in "$@"; do
    [[ -n "$(tf_out "$name")" ]] || missing+=("$name")
  done
  [[ ${#missing[@]} -eq 0 ]] || die "tofu output(s) empty: ${missing[*]} — run 'apply' first (state has no outputs; refusing to push a warning box to GitHub)"
}

# The tofu outputs `secrets` reads to push CI's auth secrets + public config. Single-sourced so
# the require_outputs gate in secrets() and the _tf_outputs_present predicate below can never
# disagree on "which outputs must exist before we may push to GitHub / pre-dispatch CI".
SECRETS_REQUIRED_OUTPUTS=(gcp_project_id deployer_service_account_email wif_provider app_domain email_from)

# _tf_outputs_present: true iff EVERY output `secrets` needs is present + non-empty — i.e. the
# state has been applied and holds live outputs. This is the real precondition for pre-dispatching
# CI (secrets refresh → deploy provision) BEFORE apply: that overlap only works when the outputs
# `secrets` reads already exist. They DO after a `suspend` (which keeps the SAs/WIF/static vars),
# but do NOT after a `down` (full destroy → 0 outputs) or a first-ever bring-up. up()/resume() gate
# on THIS rather than on a GitHub-side "do the CI secrets exist?" check: stale GitHub secrets can
# outlive a `down` that erased the outputs to refresh them from, so a GitHub-side check would
# green-light a pre-dispatch that then reads an empty state and pushes garbage. Checking the outputs
# directly is the only correct gate. Best-effort read: any tofu hiccup yields empty → "not present"
# → the safe serial fallback (apply first, then secrets).
_tf_outputs_present() {
  local name
  for name in "${SECRETS_REQUIRED_OUTPUTS[@]}"; do
    [[ -n "$(tf_out "$name")" ]] || return 1
  done
}

# app_config_blob: print the devstash-app-config JSON from its newest ENABLED version, or
# nothing (empty output, non-fatal) if the secret is absent/has no enabled version. The
# newest-ENABLED-version resolution (and the reason we avoid `access latest`) lives in
# ds_access_secret_blob (infra/lib/common.sh), shared with the ops-config read in dns.sh.
app_config_blob() {
  ds_access_secret_blob devstash-app-config "$PROJECT_ID"
}

# gh_var_value <name>: echo the value of a GitHub Actions *variable* (empty if absent).
# `gh variable list` exits 0 even when the variable is missing, so a per-name value fetch is
# the only reliable presence check — centralised here so secrets() never repeats the jq select.
gh_var_value() {
  gh variable list --json name,value \
    -q ".[] | select(.name==\"$1\") | .value" 2>/dev/null || true
}

# gh_var_set_or_clear <name> <value>: set the variable when <value> is non-empty, else
# best-effort DELETE any stale copy so a disabled feature toggle (Cloud Armor, Binary
# Authorization) leaves no lingering var for the CI step to key off. Collapses the
# set-if-present-else-delete pattern secrets() otherwise repeats for every optional toggle.
gh_var_set_or_clear() {
  local name="$1" value="$2"
  if [[ -n "$value" ]]; then
    gh variable set "$name" --body "$value"
  else
    gh variable delete "$name" >/dev/null 2>&1 || true
  fi
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
  # shellcheck disable=SC2034  # read by the sourced lib/suspend.sh (shared scope), not here
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
# bootstrap (+ _bootstrap_* steps) lives in lib/bootstrap.sh; reconcile_state (+ its nested
# _reconcile_* helpers) lives in lib/reconcile.sh — both sourced above and sharing this scope.

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
#
# _ongoing_autosuspend_build_ids: echo the ongoing (QUEUED/WORKING) Cloud Build IDs for THIS
# env's auto-suspend trigger, newline-separated, empty if none. Match by the trigger's NAME
# (Cloud Build's built-in TRIGGER_NAME substitution), which is stable across trigger replaces —
# unlike buildTriggerId, which is regenerated whenever the trigger is recreated. Single-sourced
# so wait_for_no_autosuspend_build (below) and cleanup_builds (lib/suspend.sh) can never drift
# on how "our auto-suspend build" is identified. Non-fatal on a transient list error (|| true).
_ongoing_autosuspend_build_ids() {
  gcloud builds list --region="$REGION" --project="$PROJECT_ID" --ongoing \
    --filter="substitutions.TRIGGER_NAME=devstash-${ENVIRONMENT}-auto-suspend" \
    --format='value(id)' 2>/dev/null || true
}

wait_for_no_autosuspend_build() {
  local trigger="devstash-${ENVIRONMENT}-auto-suspend"
  local deadline=$(( SECONDS + 900 ))  # cap the wait so a stuck build can't hang us forever
  local id
  while :; do
    id="$(_ongoing_autosuspend_build_ids | head -1)"
    [[ -z "$id" ]] && return 0
    if (( SECONDS >= deadline )); then
      die "auto-suspend build $id ($trigger) still running after 900s — it holds the state lock. Wait for it to finish (gcloud builds log $id --region=$REGION) or cancel it, then re-run."
    fi
    warn "auto-suspend build $id ($trigger) is running and holds the state lock — waiting for it to finish before applying…"
    sleep 20
  done
}

# mark_provisioning / clear_provisioning: a GCS marker object read by auto-suspend-guard.sh's
# idle-traffic check. That check can't tell a fresh provisioning apply (real work against the
# cluster, but zero LB traffic yet) from a genuinely idle env — the same gap the guard already
# closes for deploy-gke.yml via the GitHub Actions API, but a plain local `apply` dispatches no
# CI run for it to poll. This closes the reverse-race window too: wait_for_no_autosuspend_build
# only rejects a build that has ALREADY started; if the guard evaluates in the split second
# before we write this marker, it can still greenlight a suspend. -lock-timeout on the tofu
# commands below is the last line of defense for that residual sliver.
# Written right before we'd contend for the lock and removed on every exit path (success,
# apply failure, or abort) — see apply()'s three clear_provisioning call sites. On a SUCCESSFUL
# apply the marker is held for IAM_PROPAGATION_COOLDOWN past completion (not cleared instantly):
# a successful apply can durably mutate project IAM (e.g. the auto-suspend lifecycle SA's own
# bindings), and GCP's IAM read path can lag the write by up to ~1-2 min, wide enough for the
# auto-suspend guard's next tick to see stale "no diff" state and greenlight a suspend that then
# self-403s mid-teardown (see the sleep call site's comment for the incident). Failure/abort
# paths clear it immediately — no IAM mutation is assumed to have landed on those paths.
# Best-effort throughout (never fails the apply): a write/delete hiccup here must not block
# provisioning, and a stale marker just costs one skipped idle-suspend tick, self-healing on
# the next `apply` (which overwrites it) or once it ages past the guard's idle-window grace.
mark_provisioning()  { gcloud storage cp /dev/null "gs://$STATE_BUCKET/${STATE_PREFIX}.provisioning" >/dev/null 2>&1 || true; }
clear_provisioning() { gcloud storage rm "gs://$STATE_BUCKET/${STATE_PREFIX}.provisioning" >/dev/null 2>&1 || true; }

# apply: initialise the Terraform remote backend and run plan → apply.
# Requires the state bucket to exist (bootstrap must have run first).
# Always plans to a file and applies that exact plan so there is no drift between
# the reviewed diff and what actually mutates GCP. The plan file is gitignored and
# deleted after apply (success or failure) so no sensitive state lingers on disk.
apply() {
  ensure_tfvars
  # Saved plans contain sensitive values, so they must never linger, on any exit path
  # below — success, apply failure, or abort. `die` (common.sh) calls `exit`, which would
  # bypass a RETURN trap, and an EXIT trap here would clobber up()'s own EXIT trap (set
  # around its call to apply() to cancel a pre-dispatched CI run on failure — traps don't
  # stack in bash, the last one set wins). So this stays an explicit local helper, called
  # at every exit point, rather than a trap.
  #
  # clear_provisioning is called separately (not inlined here) on the SUCCESS path only —
  # see the IAM_PROPAGATION_COOLDOWN sleep below for why a successful apply must not clear
  # the marker immediately.
  _clear_plan_file() { rm -f "$PLAN_FILE" "$TF_DIR/$PLAN_FILE"; }
  # Always start from a clean slate: delete any stale plan file so `up`/`apply` ALWAYS
  # regenerate a fresh plan below against current state + tfvars. A leftover plan from a
  # prior run must never be applied — it could no longer match reality.
  _clear_plan_file
  # Guard: the GCS state bucket must exist before `tofu init` can initialise the
  # remote backend. If `bootstrap` was skipped, the init fails with a cryptic
  # "bucket not found" error. Check explicitly so the message is actionable.
  if ! gcloud storage buckets describe "gs://$STATE_BUCKET" >/dev/null 2>&1; then
    die "State bucket gs://$STATE_BUCKET not found — run 'bootstrap' first to create it."
  fi
  # Serialise against the scheduled idle auto-suspend build BEFORE touching state — they share
  # one lock and would otherwise collide mid-apply (see wait_for_no_autosuspend_build). Only
  # mark ourselves as provisioning AFTER this clears (not before): marking earlier would leave
  # the marker behind on the die() timeout path above, since that exits before _clear_plan_file
  # runs — and there is no reason to claim "provisioning" while still blocked on someone else's
  # build anyway.
  wait_for_no_autosuspend_build
  # See mark_provisioning's comment: closes the residual race where the guard evaluates in the
  # split second between the wait above clearing and tofu actually acquiring the lock below.
  mark_provisioning
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
      _clear_plan_file
      # Force the state history down to STATE_KEEP_VERSIONS the instant the write lands, rather
      # than waiting for the bucket's ~daily lifecycle sweep. Best-effort (never aborts apply):
      # the state is already durably written and the lifecycle rule backstops anything missed.
      gcs_prune_versions "gs://$STATE_BUCKET/$STATE_PREFIX" "$STATE_KEEP_VERSIONS"
      # IAM propagation cooldown — hold the provisioning marker past the apply's own completion.
      # A successful apply that touched project IAM bindings (e.g. the lifecycle SA's own roles)
      # is not immediately consistent: GCP's IAM read path can lag the write by up to ~1-2 min.
      # Exactly this gap cost a real suspend build: `run.sh apply` cleared the marker the
      # instant `tofu apply` returned, the auto-suspend guard's very next tick (seconds later)
      # found no lock and no marker, greenlit a suspend, and by the time suspend.sh reached its
      # own `tofu apply` minutes later the lifecycle SA's bindings were mid-propagation — its
      # apply then 403'd "Policy update access denied" self-modifying its own project IAM
      # (auto-suspend.tf's lifecycle_roles INVARIANT), stranding the build before the cleanup
      # steps (registry/build/NEG) ran. Sleeping here — not shortening the guard's own idle-
      # window grace — keeps the fix isolated to the one path that actually mutates IAM.
      log "Waiting ${IAM_PROPAGATION_COOLDOWN}s for IAM propagation before releasing the provisioning marker"
      sleep "$IAM_PROPAGATION_COOLDOWN"
      clear_provisioning
    else
      # Saved plans contain sensitive values; remove it on failure as well as success. No IAM
      # mutation is assumed to have landed durably on this path, so clear the marker immediately.
      _clear_plan_file
      clear_provisioning
      die "OpenTofu apply failed"
    fi
  else
    _clear_plan_file
    clear_provisioning
    die "aborted before apply"
  fi
  # Only fetch kubectl creds when a cluster exists. use_cluster_soft handles the missing-
  # cluster sentinel (suspended env) AND the post-fetch GKE-context check consistently with
  # every other credential-fetching entry point (eso/reloader/verify-secrets/upgrade-helm/
  # status/logs) — apply() used to duplicate this inline and skip that guard.
  log "Fetching kubectl credentials"
  use_cluster_soft "no cluster (environment suspended) — skipping kubectl credential fetch"
}

# _apply_and_wire: the standard post-bootstrap bring-up tail — apply the plan, wait for the
# control plane, install the in-cluster operators, push CI secrets, then print + assert DNS.
# Single-sourced so the `apply` dispatch command and up()'s first-ever (serial) branch can never
# drift on this sequence. dns_hint prints the record; update_dns then asserts it automatically
# (self-guarding — it warns + falls back to the printed hint when creds/IP are missing, so the
# manual path still works on a first-ever bring-up before Spaceship creds are stored).
_apply_and_wire() {
  apply
  wait_for_cluster
  eso
  secrets
  dns_hint
  update_dns
}

# eso / reloader / upgrade_helm / status / logs live in lib/gke.sh (sourced above).

# secrets: read Terraform outputs and write them as GitHub Actions secrets/variables.
# Sets DEPLOYER_SA, WORKLOAD_IDENTITY_PROVIDER (secrets), GCP_PROJECT_ID and
# APP_DOMAIN (variables, non-secret). Verifies every value was accepted before returning.
# Must run after a successful `apply` so the tofu outputs exist.
secrets() {
  log "Pushing GitHub Actions secrets from tofu output"
  gh auth status >/dev/null 2>&1 || die "gh CLI not authenticated — run: gh auth login"
  # Gate FIRST, in this shell, so a missing output aborts before any `gh` call — a `die` inside the
  # `$(…)` bodies below would only kill the subshell and let `gh … --body ""` prompt interactively.
  require_outputs "${SECRETS_REQUIRED_OUTPUTS[@]}"
  gh secret set DEPLOYER_SA               --body "$(tf_out deployer_service_account_email)"
  gh secret set WORKLOAD_IDENTITY_PROVIDER --body "$(tf_out wif_provider)"
  # GCP_PROJECT_ID is a GitHub *variable*, not a secret. A project ID is not sensitive (it
  # appears in every image ref, IAM binding, and URL), and — critically — GitHub DROPS any
  # job output whose value contains a secret. The build-push job's image_uri/migrate_image
  # outputs embed the project ID in the registry path; as a secret they crossed the job
  # boundary EMPTY, so the deploy job applied `@sha256:…` with no repo base → the migrate
  # Job hit InvalidImageName and the web rollout never started. As a variable the outputs
  # survive intact. (Read in CI as ${{ vars.GCP_PROJECT_ID }}.)
  gh variable set GCP_PROJECT_ID          --body "$(tf_out gcp_project_id)"
  # Delete any stale GCP_PROJECT_ID *secret* left from before this became a variable. GitHub
  # masks a value if it is defined as a secret ANYWHERE — regardless of whether the workflow
  # reads secrets.* or vars.* — so a lingering secret would keep redacting the image-URI job
  # outputs and re-break the migrate/rollout gate even though CI now reads vars.*. Idempotent:
  # `|| true` swallows the not-found exit once the secret is gone.
  gh secret delete GCP_PROJECT_ID >/dev/null 2>&1 || true
  # APP_DOMAIN is a GitHub *variable* (non-secret public config), not a secret.
  # It is read by the CI workflow as ${{ vars.APP_DOMAIN }} and injected into
  # settings.yaml as the public host for the HTTPRoute + NEXTAUTH_URL (TLS is served by
  # the Certificate Manager cert map, referenced separately via data.certMapName).
  gh variable set APP_DOMAIN              --body "$(tf_out app_domain)"
  gh variable set EMAIL_FROM              --body "$(tf_out email_from)"
  gh variable set ENABLE_GITHUB_ATTESTATIONS --body "false"
  # Cloud Armor toggle — inject-settings.sh keys the GCPBackendPolicy securityPolicy on this.
  # true → CI attaches devstash-dev-armor; cleared (dev $0 default) → var deleted (no WAF).
  local armor=""; [[ "$(tf_out armor_enabled false)" == "true" ]] && armor="true"
  gh_var_set_or_clear ARMOR_ENABLED "$armor"
  # Binary Authorization attestor/KMS resource names (non-secret) — read by the "Sign images
  # for Binary Authorization" CI step (see modules/gke/main.tf). When binauthz_enabled=false
  # these outputs are null, so gh_var_set_or_clear deletes any stale vars and the CI step
  # self-skips instead of signing against a gone attestor. attestor gates the KMS pair: it is
  # non-empty iff the pipeline is provisioned, so the -raw reads below never hit a null output.
  local attestor keyring="" key=""
  attestor="$(tf_out binauthz_attestor_name)"
  if [[ -n "$attestor" ]]; then
    require_outputs binauthz_kms_keyring binauthz_kms_key
    keyring="$(tf_out binauthz_kms_keyring)"
    key="$(tf_out binauthz_kms_key)"
  fi
  gh_var_set_or_clear BINAUTHZ_ATTESTOR    "$attestor"
  gh_var_set_or_clear BINAUTHZ_KMS_KEYRING "$keyring"
  gh_var_set_or_clear BINAUTHZ_KMS_KEY     "$key"
  if [[ -n "$attestor" ]]; then
    ok "DEPLOYER_SA / WORKLOAD_IDENTITY_PROVIDER set as secrets; GCP_PROJECT_ID / APP_DOMAIN / EMAIL_FROM / ENABLE_GITHUB_ATTESTATIONS / BINAUTHZ_* set as variables"
  else
    ok "DEPLOYER_SA / WORKLOAD_IDENTITY_PROVIDER set as secrets; GCP_PROJECT_ID / APP_DOMAIN / EMAIL_FROM / ENABLE_GITHUB_ATTESTATIONS set as variables (Binary Authorization disabled — BINAUTHZ_* cleared)"
  fi

  _verify_pushed_secrets
}

# _verify_pushed_secrets: re-read GitHub and confirm every value secrets() just pushed actually
# landed — the write half of `gh secret/variable set` exits 0 even on a silent failure, so a
# read-back is the only proof. Split out of secrets() so the push and the verification each read
# as one responsibility. Required secrets missing → die (a real setup failure); required
# variables missing → warn (secrets() already reported success, so surface but don't abort);
# optional feature toggles → reported only when present (absent by design in the dev $0 posture).
_verify_pushed_secrets() {
  log "Verifying GitHub Actions secrets are present"
  # Use JSON output so column-aligned table text never causes a false miss.
  # NOTE: APP_DOMAIN is a variable (not a secret) — it is NOT verified here because
  # `gh secret list` only lists secrets. Verify it with: gh variable list
  local names missing=0
  names="$(gh secret list --json name -q '.[].name')"
  count_missing "$names" DEPLOYER_SA WORKLOAD_IDENTITY_PROVIDER || missing=$?
  [[ $missing -eq 0 ]] || die "$missing secret(s) not confirmed in GitHub — re-run 'secrets'"
  # Separately verify the variables — gh variable list exits 0 even if empty, so a
  # per-variable value fetch is the only reliable presence check.
  local gh_var gh_val
  # Always-present variables — a missing one is a real setup failure.
  for gh_var in GCP_PROJECT_ID APP_DOMAIN EMAIL_FROM ENABLE_GITHUB_ATTESTATIONS; do
    gh_val="$(gh_var_value "$gh_var")"
    if [[ -z "$gh_val" ]]; then
      warn "$gh_var variable not found in GitHub — gh variable set may have failed; re-run 'secrets'"
    else
      ok "$gh_var variable = $gh_val"
    fi
  done
  # Optional feature toggles — absent by design in the dev $0 posture (Binary Authorization
  # off, Cloud Armor off), so report only when present rather than warning on absence.
  for gh_var in ARMOR_ENABLED BINAUTHZ_ATTESTOR BINAUTHZ_KMS_KEYRING BINAUTHZ_KMS_KEY; do
    gh_val="$(gh_var_value "$gh_var")"
    [[ -n "$gh_val" ]] && ok "$gh_var variable = $gh_val"
  done
  # Explicit success: the loop above ends on a possibly-false test (all optional toggles absent in
  # the dev $0 posture), which — via the trailing `&&` — would otherwise make this function, and
  # `run.sh secrets` under set -e, and the resume/up flows that call it mid-sequence, return that
  # non-zero. Every real failure above already `die`d; reaching here means success. This one
  # explicit return is the sole guard, so the loop body stays a terse one-liner.
  return 0
}

# dns_hint / update_dns / spaceship_api / set_dns_creds live in lib/dns.sh (sourced above).

# deploy: dispatch the deploy-gke.yml GitHub Actions workflow via `gh workflow run`.
# The workflow builds the container, pushes to Artifact Registry, runs DB migrations,
# and rolls out the new image to GKE. Follow progress with `gh run watch`.
#
# Sets DEPLOY_RUN_ID to the dispatched run's database ID so a caller (e.g. resume) can
# watch it directly instead of re-discovering "the latest run" later, which would race
# against any other deploy-gke run a human or auto-suspend triggers in between. `gh
# workflow run` itself does not return the new run's ID, so the ID of the newest
# existing run is recorded BEFORE dispatch and poll_until waits for a strictly newer
# one to appear (GitHub takes a few seconds to register a dispatched run).
#
# $1 == "provision": pass `-f reason=provision` so CI's `gate` job builds even though the
# cluster does not exist yet (a run.sh resume/up PRE-DISPATCH that overlaps `apply`). Called
# WITHOUT that arg (bare `run.sh deploy`, or a manual dispatch) the gate falls back to the
# live cluster check — correct for a deploy against an already-active env, and it declines to
# waste a build on a parked one. See infra/ci/decide-build.sh + deploy-gke.yml `gate` job.
deploy() {
  local reason="${1:-}"
  log "Triggering the deploy-gke CI workflow (build web+migrate → push → apply -k → migrate Job → rollout)"
  local before_id
  before_id="$(gh run list --workflow deploy-gke.yml --limit 1 --json databaseId -q '.[0].databaseId' 2>/dev/null || true)"
  if [[ "$reason" == "provision" ]]; then
    gh workflow run deploy-gke.yml -f reason=provision
  else
    gh workflow run deploy-gke.yml
  fi
  DEPLOY_RUN_ID=""
  _new_run_appeared() {
    local id
    id="$(gh run list --workflow deploy-gke.yml --limit 1 --json databaseId -q '.[0].databaseId' 2>/dev/null || true)"
    [[ -n "$id" && "$id" != "$before_id" ]] && DEPLOY_RUN_ID="$id"
  }
  poll_until 12 5 -- _new_run_appeared \
    || { warn "dispatched, but could not confirm the new run ID — follow it with: gh run watch"; return 0; }
  ok "dispatched — run $DEPLOY_RUN_ID — follow it with:  gh run watch $DEPLOY_RUN_ID"
}

# _predispatch_ci_build: the shared "pre-dispatch the deploy so its cluster-independent build-push
# job overlaps apply" step used identically by up()'s and resume()'s outputs-present branch. CI
# authenticates to GCP with the WIF/DEPLOYER_SA GitHub secrets, so `secrets` MUST run first to
# refresh them against the current tofu outputs before the just-dispatched run tries to authenticate.
# ONLY call this when _tf_outputs_present (the outputs `secrets` reads exist) — the callers gate on it.
# `deploy provision` then tells CI's gate job to build even though the cluster does not exist yet
# (we are mid-provision). Sets DEPLOY_RUN_ID (via deploy) for the watch + the cancel trap below.
_predispatch_ci_build() {
  secrets
  deploy provision   # sets DEPLOY_RUN_ID
}

# _arm_ci_cancel_trap: install the EXIT trap that cancels the pre-dispatched CI run if the caller
# exits early before handing ownership to its own watch/return. Both up() and resume() call `apply`
# after pre-dispatch, and apply()'s internal `die` (exit 1) means a plain `if ! apply` could never
# catch a failure — so an EXIT trap is the only way to guarantee the orphaned build (left compiling
# against infra that will never finish provisioning) is cancelled on ANY non-zero exit. The caller
# MUST clear it with `trap - EXIT` the instant it takes ownership of the run — a successful bring-up
# must not cancel the very run it is about to watch. Traps do NOT stack in bash (the last one set
# wins), which is exactly why this delicate block is single-sourced here rather than copied into
# both call sites where a one-sided future edit would silently orphan runs. No-op when DEPLOY_RUN_ID
# is unset (deploy couldn't confirm the run id) — nothing to cancel.
_arm_ci_cancel_trap() {
  local phase="$1"   # "up" or "resume" — only used in the warning message
  [[ -n "${DEPLOY_RUN_ID:-}" ]] || return 0
  # shellcheck disable=SC2064,SC2154  # expand DEPLOY_RUN_ID + phase NOW (fixed values); rc IS
  # assigned (rc=$?) and read within the trap string — shellcheck can't see across the trap boundary.
  trap "rc=\$?; [[ \$rc -ne 0 ]] && { gh run cancel '$DEPLOY_RUN_ID' >/dev/null 2>&1 || true; warn '$phase failed — cancelled pre-dispatched CI run $DEPLOY_RUN_ID'; }" EXIT
}

# _watch_ci_run: take ownership of the dispatched deploy-gke run (DEPLOY_RUN_ID) and BLOCK on it,
# surfacing pass/fail in this same terminal invocation instead of firing-and-forgetting — a resume
# that merely kicks CI off and returns "done" hides a hung/failed build behind a healthy-looking
# cluster (ESO/Reloader up, but no devstash-web Deployment until the run's rollout step lands).
# Clears the EXIT cancel-trap FIRST so a `return 1` on CI failure does not also cancel the run we
# just watched fail (the watch already reported it; cancelling a finished run is noise). Shared by
# both resume() branches (pre-dispatched overlap AND the post-down serial dispatch). Returns 1 on
# CI failure so the caller propagates it. No confirmed run id → warn + manual hint, success (0).
_watch_ci_run() {
  trap - EXIT
  if [[ -z "${DEPLOY_RUN_ID:-}" ]]; then
    warn "could not confirm the dispatched run — follow it manually:  gh run watch"
    return 0
  fi
  log "Watching deploy-gke run $DEPLOY_RUN_ID (build+push has its own retry/timeout — see deploy-gke.yml)"
  if gh run watch "$DEPLOY_RUN_ID" --exit-status; then
    ok "CI run $DEPLOY_RUN_ID completed successfully — devstash-web is rolled out"
    log "Next: bash infra/run/gcp/run.sh smoke   # health-check the live app"
    return 0
  fi
  warn "CI run $DEPLOY_RUN_ID FAILED — devstash-web is not deployed. Check: gh run view $DEPLOY_RUN_ID --log-failed"
  warn "Re-run the deploy once fixed:  bash infra/run/gcp/run.sh deploy"
  return 1
}

# _apply_with_overlap: the `apply` dispatch command's tail. When the tofu outputs `secrets` reads
# already exist (_tf_outputs_present — an apply against an already-provisioned env, e.g. a plain
# re-apply or a config tweak), pre-dispatch the deploy-gke build so its cluster-INDEPENDENT
# build-push job (AR repo already exists; buildx cache is type=gha; auth is WIF) runs WHILE apply
# reprovisions — the same overlap up()/resume() already do, so image build stops sitting serialized
# behind the ~11-min Cloud SQL create. Unlike resume(), this does NOT block on the run: apply is an
# infra command, so it returns as soon as infra is wired and prints `gh run watch <id>` for the
# background build (per-case decision — a bare `apply` should not turn into a long deploy-and-wait).
# The cancel trap still reaps the orphaned run if apply itself dies before the handoff. When the
# outputs are ABSENT (a first-ever apply before any provision), there is nothing to authenticate a
# CI build against, so fall back to the plain serial _apply_and_wire with the deploy left manual —
# mirroring up()'s two branches. Gating on OUTPUTS (not stale GitHub secrets) matches up()/resume().
_apply_with_overlap() {
  if _tf_outputs_present; then
    log "Tofu outputs present — pre-dispatching deploy so its build overlaps apply"
    _predispatch_ci_build          # secrets refresh → deploy provision; sets DEPLOY_RUN_ID
    _arm_ci_cancel_trap apply      # cancel the run if apply dies before the handoff below
    _apply_and_wire
    trap - EXIT   # infra is wired; the run now owns its own success/failure — stop cancelling it
    log "Infra applied and the app deploy is building/rolling out in parallel. Follow it:"
    [[ -n "${DEPLOY_RUN_ID:-}" ]] && echo "  gh run watch $DEPLOY_RUN_ID   # build → migrate → rollout"
    echo "  bash infra/run/gcp/run.sh smoke   # wait for CI + verify health endpoint"
    return 0
  fi
  # First-ever apply (no tofu outputs yet): serial order, app deploy stays a manual next step.
  _apply_and_wire
  log "Infra applied. Next:"
  echo "  bash infra/run/gcp/run.sh deploy   # build + migrate + roll out the app"
  echo "  bash infra/run/gcp/run.sh smoke    # wait for CI + verify health endpoint"
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
    ok "all ${#expected[@]} required keys present in devstash-app-config"
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
  # read_secret (common.sh) single-sources the never-echo-a-credential input idiom (hidden tty
  # prompt, or a plain stdin line when piped) shared with set_dns_creds in dns.sh.
  read_secret "New value for devstash-${secret_name}: " new_value
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

# upgrade_helm / _app_healthy live in lib/gke.sh (sourced above).

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

# status / logs live in lib/gke.sh (sourced above).

# empty_bucket <gs://bucket>: recursively delete every object (all versions) in a bucket so
# the no-force_destroy guard on google_storage_bucket does not block `tofu destroy`. Best-
# effort — an absent/already-empty bucket (or one destroyed earlier in the same run) must not
# abort the teardown. `--all-versions` reaches noncurrent generations too (both buckets have
# versioning on), otherwise archived versions keep the bucket non-empty and the delete fails.
empty_bucket() {
  local uri="$1"
  [[ -n "$uri" ]] || return 0
  gcloud storage buckets describe "$uri" --project="$PROJECT_ID" >/dev/null 2>&1 || return 0
  log "Emptying $uri (all object versions) so destroy can delete the bucket"
  gcloud storage rm -r --all-versions "$uri/**" --quiet --project="$PROJECT_ID" \
    || warn "empty of $uri returned non-zero (likely already empty) — continuing"
}

# force_release_psa: after `tofu destroy`, reclaim the leftover PSA plumbing GCP holds past the
# teardown. The service_networking_connection is ABANDONed on destroy (see modules/network) — it
# is dropped from state but the actual GCP peering + its reserved global address linger until
# GCP's producer lock clears (up to ~4 days after the last Cloud SQL instance died). Try to
# force them now so a `down` leaves the GCP side clean rather than trickling out over days.
# BOTH deletes are best-effort: the peering delete may still hit the producer lock (identical to
# the destroy path — nothing we can do but wait), and the address delete 409s until the peering
# releasing frees it. A miss here is not a teardown failure; it just means GCP finishes the job
# on its own schedule. Names are deterministic (modules/network name_prefix = devstash-<env>).
force_release_psa() {
  local vpc="devstash-${ENVIRONMENT}-vpc"
  local psa_range="devstash-${ENVIRONMENT}-psa"
  # Only attempt if the VPC still exists — a fully-completed destroy already removed it, and
  # then there is no peering to reap. `describe` is the existence probe; --project is explicit.
  gcloud compute networks describe "$vpc" --project="$PROJECT_ID" >/dev/null 2>&1 || return 0
  log "Force-releasing leftover PSA peering on $vpc (ABANDONed on destroy; GCP may still hold it)"
  gcloud services vpc-peerings delete --network="$vpc" \
    --service=servicenetworking.googleapis.com --project="$PROJECT_ID" --quiet \
    || warn "PSA peering delete returned non-zero (GCP producer lock not yet released — it clears on its own, up to ~4 days) — continuing"
  log "Releasing reserved PSA range $psa_range"
  gcloud compute addresses delete "$psa_range" --global --project="$PROJECT_ID" --quiet \
    || warn "PSA range delete returned non-zero (still held by the peering above) — continuing"
}

# down: FORCE-destroy the entire dev environment with `tofu destroy`.
# GKE and Cloud SQL are already unprotected in this env (they are torn down on every
# suspend cycle), so no deletion_protection dance is needed — destroy runs directly.
# Unlike `suspend` (which deliberately PRESERVES the verified Cloud SQL dump so `resume`
# can restore it), `down` is a full teardown: it EMPTIES the uploads + db-dumps buckets
# first so the no-force_destroy guard cannot block destroy, then force-releases the
# ABANDONed PSA peering + reserved range that GCP holds past the teardown. The state
# bucket and GCP project are left intact after destroy.
down() {
  ensure_tfvars
  # A fresh checkout has no initialized backend even when the state bucket exists.
  # Use the same explicit backend selection as apply so destroy cannot read local or
  # wrong-environment state by accident.
  tofu_ init -backend-config="bucket=$STATE_BUCKET"
  log "FORCE tear down — tofu destroy ($TF_DIR)"
  warn "This deletes the GKE cluster, Cloud SQL, and Memorystore."
  warn "UNLIKE 'suspend', 'down' also EMPTIES + DELETES the uploads AND db-dumps buckets —"
  warn "the last Cloud SQL dump is DESTROYED. There is no restore after a 'down'."
  warn "If you want a recoverable ~\$0 idle instead, use 'suspend' (keeps the dump)."
  if confirm "FORCE-destroy the entire dev environment (buckets + dump included)?"; then
    # Capture bucket names BEFORE destroy — the tofu outputs vanish once state is gone.
    # tf_out swallows a missing output (already-suspended/partial env) → empty, which
    # empty_bucket treats as a no-op.
    local uploads_uri db_dumps_uri
    uploads_uri="$(tf_out uploads_bucket)"; [[ -n "$uploads_uri" ]] && uploads_uri="gs://$uploads_uri"
    db_dumps_uri="$(tf_out db_dumps_bucket)"; [[ -n "$db_dumps_uri" ]] && db_dumps_uri="gs://$db_dumps_uri"
    empty_bucket "$uploads_uri"
    empty_bucket "$db_dumps_uri"
    # Reap GKE-leaked NEGs + firewall rules BEFORE destroy — they reference the VPC and would
    # otherwise fail its delete ("network resource is already being used by …/networkEndpointGroups/
    # …"). cleanup_leaked_negs (lib/suspend.sh) is VPC-scoped and best-effort. This must run before
    # destroy, unlike the suspend path where it runs after (there the cluster destroy is a Terraform
    # apply, not a full VPC teardown, so the VPC survives and the NEGs only need reaping for later).
    cleanup_leaked_negs
    # The script already obtained explicit confirmation; avoid a second prompt that
    # makes AUTO_APPROVE=1 ineffective in automation.
    #
    # -refresh=false: destroy from state WITHOUT the pre-destroy refresh. `down` is a full
    # teardown, so we don't need to reconcile against live state first — and a resource the
    # env deleted out-of-band (e.g. the Artifact Registry repo + its repo-scoped IAM members,
    # which a deep-suspend destroys through Terraform / an older suspend deleted via gcloud)
    # would otherwise 403 during that refresh: GCP answers getIamPolicy on a vanished repo with
    # 403 (not 404), aborting the whole teardown before any destroy runs. Skipping the refresh
    # makes destroy operate on state alone — an already-gone resource just 404s on its own
    # delete call, which the provider tolerates, and the teardown proceeds. (Force-delete,
    # catch-if-absent, move on.) State-only destroy is safe here precisely because down()
    # removes EVERYTHING (bar the excluded secrets); there is no partial-state risk to guard against.
    #
    # -exclude the two Secret Manager secret CONTAINERS so a full `down` PRESERVES them (and,
    # by dependency, their versions + IAM grants — `-exclude` spares anything depending on the
    # excluded address). Both carry lifecycle.prevent_destroy = true, so WITHOUT these excludes
    # `tofu destroy` would ERROR ("Instance cannot be destroyed") and abort the whole teardown.
    # Rationale for keeping them: Secret Manager is ~$0 (inside the free version tier) and
    # re-entering the app + Spaceship-DNS creds by hand after every teardown is the real cost.
    # These are the ONLY prevent_destroy resources in the env — keep this list in sync if that
    # changes. Addresses: app_config lives in module.iam; ops_config is top-level in envs/dev.
    tofu_ destroy -auto-approve -refresh=false \
      -exclude=module.iam.google_secret_manager_secret.app_config \
      -exclude=google_secret_manager_secret.ops_config
    # Reclaim the PSA peering + range GCP holds past the ABANDONed connection (best-effort).
    force_release_psa
    ok "destroyed. (State bucket gs://$STATE_BUCKET and the project are left intact.)"
  else
    die "aborted"
  fi
}

# ── suspend / resume (on-demand showcase) ───────────────────────────────────
# The DB dump/restore (resolve_dump_target/dump_db/restore_db), DNS (spaceship_api/update_dns/
# set_dns_creds/dns_hint), and the suspend/resume orchestrators (set_active_state/suspend/
# resume) live in lib/db.sh, lib/dns.sh, and lib/suspend.sh — all sourced above and sharing
# this shell's scope.

# up: full bring-up — bootstrap → apply → cluster-side wiring → DNS. Like `resume`, it PRE-
# DISPATCHES the deploy-gke workflow (whose cluster-independent build-push job then builds +
# pushes WHILE `apply` provisions Cloud SQL ~10 min + the control plane) — but ONLY when the tofu
# outputs `secrets` reads already exist (_tf_outputs_present). On a first-ever `up`, or an `up`
# after a `down` erased the outputs, they do NOT, so `secrets` cannot push WIF/DEPLOYER_SA and a
# pre-dispatched CI run would fail at auth (worse: pre-2026-07 it pushed the #26991 warning box);
# there we keep the serial order and leave `deploy` as a printed manual next step. Gating on the
# OUTPUTS (not stale GitHub secrets, which can outlive the `down` that erased the outputs) mirrors
# resume(). Unlike `resume`, `up` also runs `bootstrap` (project/billing/state/APIs), no DB restore.
up() {
  preflight
  bootstrap
  if _tf_outputs_present; then
    log "Tofu outputs present — pre-dispatching deploy so its build overlaps apply"
    # Same overlap + cancel-on-early-exit pattern as resume(): pre-dispatch CI (secrets refresh →
    # deploy provision) so build-push runs WHILE apply provisions, arm the cancel trap so an early
    # exit reaps the orphaned run, then apply in parallel. Both steps single-sourced above.
    _predispatch_ci_build          # sets DEPLOY_RUN_ID
    _arm_ci_cancel_trap up         # cancel the run if anything below dies before the handoff
    apply
    wait_for_cluster
    eso
    trap - EXIT   # cluster is up; the run now owns its own success/failure — stop cancelling it
    dns_hint; update_dns
    log "Infra up and the app deploy is building/rolling out in parallel. Follow it:"
    [[ -n "${DEPLOY_RUN_ID:-}" ]] && echo "  gh run watch $DEPLOY_RUN_ID   # build → migrate → rollout"
    echo "  bash infra/run/gcp/run.sh smoke   # wait for CI + verify health endpoint"
    return 0
  fi
  # First-ever bring-up, or an `up` after a `down` (no tofu outputs yet): serial order, app deploy
  # stays manual. _apply_and_wire runs the apply→wait→eso→secrets→dns tail (shared with `apply`).
  _apply_and_wire
  log "Bootstrap + infra done. Next:"
  echo "  1. If the DNS A-record above was not set automatically (creds missing),"
  echo "     add it by hand, then wait for the cert to go Active."
  echo "  2. bash infra/run/gcp/run.sh verify-secrets  # confirm all SM secrets exist + ESO synced"
  echo "  3. bash infra/run/gcp/run.sh deploy          # build + migrate + roll out the app"
  echo "  4. bash infra/run/gcp/run.sh smoke           # wait for CI + verify health endpoint"
}

# ── dispatch ───────────────────────────────────────────────────────────────

case "$CMD" in
  up)              up ;;
  bootstrap)       preflight; bootstrap ;;
  # update_dns re-points the gke.* A-record at the current ingress IP. The IP is
  # released on suspend and re-allocated fresh on every bring-up, so DNS MUST be
  # re-asserted after each apply — not just on resume — or the site resolves to the
  # dead prior IP (TLS reset / 502) until the record is fixed by hand. update_dns is
  # self-guarding: it warns-and-prints a manual hint if creds/IP are missing, and it
  # only ever touches the gke A-record (prod Vercel/email records are never affected),
  # so it strictly supersedes the print-only dns_hint here.
  apply)           preflight; _apply_with_overlap ;;
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
