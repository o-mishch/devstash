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
#   bash infra/run/gcp/run.sh unlock         interactively inspect + release a stuck OpenTofu state lock
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
#   FORCE_REPROVISION_ON_CONFLICT=1        on a 409 "already exists", unattended runs DESTROY the
#                                          live resource and let apply recreate it, instead of the
#                                          default (adopt/import it). DANGEROUS in automation — it
#                                          can wipe a live resource — so it is OFF by default and
#                                          only ever consulted on the non-interactive path; an
#                                          interactive operator is always asked adopt/recreate/abort
#                                          regardless of this flag. See _apply_with_conflict_recovery.

# ── Require a modern bash (>= 4.3), re-exec under one if the caller's is too old ──────────────
# macOS still ships bash 3.2 as /bin/bash, and the docs invoke this as `bash infra/run/gcp/run.sh`,
# so the caller's shell can be 3.2. This script uses `wait -n -p VAR` (fail-fast join that also
# reports WHICH job finished, over the parallel restore + operator installs — see
# gke.sh:ensure_operators). `wait -n` needs bash >= 4.3 and the `-p` flag needs bash >= 5.1, so we
# require >= 5.1. Rather than code around 3.2 forever, re-exec under the first modern bash we can
# find (Homebrew installs one at /opt/homebrew/bin/bash on Apple Silicon or /usr/local/bin/bash on
# Intel; `brew install bash`). The exported sentinel makes this fire AT MOST once, so a genuinely
# missing modern bash fails with a clear message instead of looping. This runs before `set -euo
# pipefail` (a bare test, no pipe) and before any sourcing, so it is the very first thing the script
# does. Canonical "restart bash if old" idiom (Limoncelli): guard on BASH_VERSINFO, export a
# one-shot flag, exec the newer bash.
if [[ "${BASH_VERSINFO[0]}" -lt 5 || ( "${BASH_VERSINFO[0]}" -eq 5 && "${BASH_VERSINFO[1]}" -lt 1 ) ]]; then
  if [[ -z "${DEVSTASH_BASH_REEXEC:-}" ]]; then
    export DEVSTASH_BASH_REEXEC=1
    for _newer_bash in /opt/homebrew/bin/bash /usr/local/bin/bash /opt/local/bin/bash; do
      if [[ -x "$_newer_bash" ]]; then exec "$_newer_bash" "$0" "$@"; fi
    done
    # Nothing hard-coded found — try PATH as a last resort (may still be the old one; the guard
    # below re-checks after this exec and fails cleanly rather than looping, since the flag is set).
    _path_bash="$(command -v bash || true)"
    [[ -n "$_path_bash" ]] && exec "$_path_bash" "$0" "$@"
  fi
  printf 'error: this script needs bash >= 5.1 (found %s). Install a modern bash: brew install bash\n' \
    "${BASH_VERSION}" >&2
  exit 1
fi

set -euo pipefail
# Fail LOUD, never silently. Under `set -e` any un-guarded non-zero command aborts the whole
# script — historically with NO message (e.g. a reconcile gcloud call fed a bad arg would exit
# 1 right after `tofu init`, leaving "up complete, nothing created" with no clue why). This ERR
# trap turns every such death into an actionable report: the exact failing command, its exit
# code, and the file:line — printed to stderr before the shell exits. `die` (explicit, message-
# bearing exits from common.sh) uses exit code 1 too, but those already print their own message
# and reason; the trap's extra one line is harmless there and invaluable everywhere else. Self-
# contained (raw ANSI, bash builtins only) so it works even before common.sh is sourced below.
rc=0  # pre-declared so the ERR trap's `rc=$?` reads as an in-scope assignment (no SC2154 across the trap-string boundary)
trap 'rc=$?; printf "\n\033[0;31m✖ run.sh FAILED\033[0m — %s:%d\n    command: %s\n    exit code: %d\n" "${BASH_SOURCE[0]}" "$LINENO" "$BASH_COMMAND" "$rc" >&2' ERR

# Interrupt-safe abort: when tofu is mid-apply, a Ctrl-C at the terminal is delivered to the whole
# foreground process group — so the child `tofu` already receives SIGINT and does its OWN graceful
# shutdown (finish the in-flight resource op, persist state, exit). The danger is that THIS bash
# also gets the SIGINT and tears down FIRST, before tofu finishes writing state — which is exactly
# how an interrupted apply strands a just-created resource in the cloud with no state entry (an
# orphan that neither re-apply nor `refresh` can ever adopt — only `import`). So on INT/TERM this
# handler only PRINTS the one-Ctrl-C guidance — it does not exit or otherwise alter control flow.
# bash defers a running trap until the in-flight FOREGROUND command finishes, so tofu completes its
# graceful shutdown and persists state first; the shell then exits via `set -e` on tofu's non-zero
# interrupt code (which the ERR trap above reports). A SECOND Ctrl-C is what tofu treats as "exit
# immediately" (cancelling the provider mid-create) — that is the operator's explicit escalation,
# not ours to send. Best-effort and self-contained (bash builtins only). This does not
# fire for the backgrounded overlap apply (a subshell in its own right); that path's join surfaces
# the child's status normally.
trap 'printf "\n\033[0;33m  ! Interrupt received — letting the in-flight OpenTofu op finish its graceful shutdown and persist state.\033[0m\n    \033[0;33mPress Ctrl-C AGAIN only if you must force-exit (this can strand a half-created resource — recover by re-running the same command).\033[0m\n" >&2' INT TERM
cd "$(dirname "${BASH_SOURCE[0]}")/../../.."   # repo root

TF_DIR=infra/terraform/envs/dev
TFVARS="$TF_DIR/terraform.tfvars"
STATE_BUCKET="${STATE_BUCKET:-}"
# GCS lifecycle config for the out-of-band state bucket. Kept as a standalone JSON file
# (not an inline heredoc) so it is diffable, jq-validatable, and reviewable as JSON.
STATE_LIFECYCLE=infra/run/gcp/tfstate-lifecycle.json
# Synchronous version cap enforced after every state write (via ds_prune_dump_versions in
# infra/lib/posix/dump.sh — the shared prune, sourced transitively through lib/db.sh). "3 total"
# = the live state + 2 noncurrent, matching the lifecycle rule in $STATE_LIFECYCLE
# (numNewerVersions=2) — the two mechanisms deliberately agree, one immediate, one async-backstop.
# State keys live under the backend prefix "gke/dev".
STATE_KEEP_VERSIONS=3
STATE_PREFIX="gke/dev/"
# How long apply() holds the provisioning marker past a SUCCESSFUL tofu apply, to cover GCP IAM
# eventual consistency — see the sleep call site in apply() for the incident this closes.
IAM_PROPAGATION_COOLDOWN=120
PLAN_FILE=devstash.tfplan
# Separate plan file for the pre-apply staging subgraphs (_staging_apply). Kept distinct from
# PLAN_FILE so a staging plan and the main plan never clobber each other's saved file when the
# overlap driver runs them close together. Gitignored + short-lived, same as PLAN_FILE.
STAGING_PLAN_FILE=devstash-staging.tfplan
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
# `tofu init`, so `tofu output/console` is not yet an option (the derived value — project_id —
# is what NAMES the state bucket that init needs, a hard chicken-and-egg): a line-oriented read
# is the only tool available this early. Scoped by design: it handles the simple quoted scalars
# this script scaffolds from tfvars.example (project_id/region/environment/app_domain), NOT
# arbitrary HCL. Rather than silently mis-parse a shape it can't handle — the dangerous failure
# mode is a truncated project_id that then points every gcloud call at the WRONG project — it
# DIES loudly on any value that isn't a simple single-line scalar: a list (`[...]`), an object
# (`{...}`), or an HCL heredoc (`<<`). $1 is interpolated into the regex, so call it only with
# literal key names (all current callers do) — never with user input.
tfvar() {
  [[ -f "$TFVARS" ]] || return 1
  local rhs
  rhs="$(grep -E "^[[:space:]]*$1[[:space:]]*=" "$TFVARS" | head -1 | sed -E 's/^[^=]*=[[:space:]]*//')"
  [[ -n "$rhs" ]] || return 0
  # Reject shapes this scalar reader can't parse, so a mis-typed tfvars fails loudly here
  # instead of leaking a truncated value into the state-bucket name / gcloud --project.
  case "$rhs" in
    '['*|'{'*|*'<<'*) die "tfvar: '$1' in $TFVARS is not a simple scalar (list/object/heredoc) — this early pre-init reader only supports quoted or bare scalars" ;;
  esac
  # Strip a trailing inline comment, then surrounding quotes and whitespace.
  sed -E 's/[[:space:]]*#.*$//; s/^"(.*)"$/\1/; s/^[[:space:]]+|[[:space:]]+$//g' <<<"$rhs"
}

tofu_() { tofu -chdir="$TF_DIR" "$@"; }

# tofu_locked_ <tofu-args…>: this script's binding of common.sh's generic tofu_locked to GCP's
# own invoker (tofu_) and interactive recovery (_recover_state_lock, below). AUTO_APPROVE=1 makes
# _recover_state_lock non-interactive (it releases a confirmed-dead lock and otherwise refuses),
# preserving the old fail-fast behavior in CI.
tofu_locked_() { tofu_locked _recover_state_lock -- tofu_ "$@"; }

# _plan_with_refresh_fallback <plan-args…>: run `tofu_locked_ plan <args>`, and if it aborts during
# the REFRESH phase because a state-tracked resource was deleted out-of-band in GCP (a 404 the
# provider surfaces as "... does not exist" / "was not found" / "Error 404"), retry the SAME plan
# once with -refresh=false so the plan proceeds against state alone (the stale entry then plans as a
# clean destroy). This is the belt-and-suspenders companion to reconcile_state's targeted
# state-rm branches (which proactively heal the drift signatures we KNOW — AR-IAM, Cloud SQL): the
# reconcile branches remove the stranded entry BEFORE the plan so this fallback normally never
# fires, but it catches any OTHER out-of-band-deleted resource we haven't enumerated, so a single
# missing component can never wedge apply/suspend the way the live 2026-07-06 Cloud SQL drift did.
#
# WHY only on the refresh-404 signature (not blanket -refresh=false): a refreshless plan trusts
# state over reality, so it can miss genuine drift. We pay that cost ONLY when a refresh is
# provably impossible (the resource is gone), never on a healthy plan. WHY a retry, not a
# pre-emptive -refresh=false: the normal refreshing plan is correct in the common case and must
# stay the default; we degrade only when it actually fails for this specific reason.
_plan_with_refresh_fallback() {
  local out rc=0
  # Capture combined output so we can inspect the failure reason. `set -e` would abort on the
  # non-zero plan, so guard with `|| rc=$?` and re-emit the captured output to the operator.
  out="$(tofu_locked_ plan "$@" 2>&1)" || rc=$?
  printf '%s\n' "$out"
  [[ $rc -eq 0 ]] && return 0
  # Refresh-time out-of-band-deletion signature. The provider phrases a vanished-resource 404 a few
  # ways across resource types; match the common ones. Only retry when the error is THIS — any other
  # plan failure (syntax, auth, a real conflict) must propagate unchanged.
  if printf '%s' "$out" | grep -qiE 'does not exist|was not found|Error 404|instanceDoesNotExist|resourceNotFound'; then
    warn "Plan hit a refresh-time 404 — a state-tracked resource was deleted out-of-band in GCP."
    warn "Retrying the plan with -refresh=false (plans against state alone; the stale entry plans as a destroy)."
    tofu_locked_ plan -refresh=false "$@"
    return $?
  fi
  return "$rc"
}

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
SECRETS_REQUIRED_OUTPUTS=(gcp_project_id deployer_service_account_email lifecycle_deployer_service_account_email wif_provider app_domain email_from)

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

# wait_for_cluster: block until the GKE control plane answers kubectl. On a fresh `tofu apply` the
# endpoint responds ~5-7 min in; on a DEEP-SUSPEND resume the control-plane endpoint is recreated
# cold and — because get_credentials_command uses the DNS-based --dns-endpoint — its reachability
# can propagate SLOWER than that (the documented deep-suspend gap: the cluster reports RUNNING before
# kubectl can connect). A fixed 10-minute ceiling used to `die` while the cluster was genuinely on its
# way up, and because resume/up arm a CI cancel trap around this call that spurious `die` ALSO
# cancelled the pre-dispatched deploy — a healthy-but-slow resume reported as a failure that killed a
# perfectly good build. Three changes fix that (see decisions below):
#
#   1. FAST-FAIL PRE-GATE — before waiting at all, confirm via `gcloud container clusters list` that
#      the cluster actually EXISTS. If it is genuinely absent (a real fault: apply never created it,
#      or it was deleted) we die immediately instead of burning the full reachability window. Once we
#      know it exists, an unreachable endpoint is "still propagating", so we wait patiently. (Listable
#      is the strongest cheap existence signal gcloud gives without a control-plane call; the top-level
#      RUNNING status does NOT imply kubectl reachability — the endpoint is decoupled from it — so we
#      don't gate on status, only on existence, then let the kubectl poll be the reachability oracle.)
#   2. LONGER, TUNABLE CEILING — default ~15 min (was a hard 10), env-overridable, to cover the
#      DNS-endpoint propagation gap. A per-attempt diagnostic line replaces silent dots.
#   3. TIMEOUT DOES NOT CANCEL CI — on reachability timeout we clear the EXIT cancel-trap FIRST (the
#      same `trap - EXIT` hand-off _watch_ci_run uses) so the pre-dispatched deploy — which has its own
#      waits and may well succeed once the endpoint settles — is LEFT RUNNING, then still `die` so the
#      local bring-up aborts loudly. A missing-cluster pre-gate failure is a real fault and DOES let the
#      trap cancel CI (there is nothing for the build to deploy onto).
#   4. TEARDOWN DETECTION (event-based join guard) — a KNOWN second operator can run down/auto-suspend
#      the same env WHILE this resume waits. Then the endpoint never answers because the cluster is
#      being DELETED, and change 3 above would wrongly leave CI running against a vanishing cluster and
#      burn the whole ceiling first. So BEFORE the poll and on EVERY poll iteration we check the real
#      teardown signal (ds_cluster_teardown_in_progress: status STOPPING/ERROR or an in-flight
#      DELETE_CLUSTER op) and, on a positive, abort IMMEDIATELY — leaving the cancel-trap ARMED so the
#      pre-dispatched deploy is reaped (a torn-down env is a real fault for this bring-up, nothing to
#      deploy onto). This replaces "wait blindly and time out" with "stop the instant the join can
#      never complete" (observed 2026-07-07: a resume sat the full window against a cluster another
#      actor had started deleting).
#
# Distinct env from check-env-active.sh's CLUSTER_WAIT_* (that gate polls cluster LISTABILITY as a
# suspended-vs-active decision; this polls kubectl REACHABILITY) so overriding one never moves the other.
# Optional env:
#   CLUSTER_REACHABLE_WAIT_ATTEMPTS (default 90) × CLUSTER_REACHABLE_WAIT_GAP secs (default 10) = ~15 min.
_cluster_reachable() { kubectl cluster-info >/dev/null 2>&1; }
# _abort_if_teardown_in_progress <cluster>: an EVENT-BASED join guard. A KNOWN second operator can
# `down`/auto-suspend the same env while this resume waits for the control plane — then the endpoint
# will NEVER answer because the cluster is being deleted, and a blind reachability poll would burn its
# whole window against a vanishing cluster (observed 2026-07-07). ds_cluster_teardown_in_progress
# reads the REAL teardown signal (status STOPPING/ERROR, or an in-flight DELETE_CLUSTER operation),
# so on a positive we abort IMMEDIATELY instead of waiting. Unlike the reachability timeout this is a
# real fault for THIS bring-up (there is nothing to deploy onto), so we LEAVE the CI cancel-trap armed
# — the pre-dispatched deploy is reaped. Called on EVERY poll iteration (via the predicate below,
# first action of iteration 1) so a teardown already in flight aborts before the first kubectl probe,
# and one that STARTS mid-wait is caught on the next pass.
_abort_if_teardown_in_progress() {
  local cluster="$1"
  # Empty cluster name (tofu output unavailable) → nothing to check; behave as the pre-teardown code
  # did and let the reachability poll be the sole oracle.
  [[ -n "$cluster" ]] || return 0
  ds_cluster_teardown_in_progress "$cluster" "$PROJECT_ID" "$REGION" 2>/dev/null || return 0
  die "GKE cluster '$cluster' is being TORN DOWN (status STOPPING/ERROR or a DELETE_CLUSTER operation is in flight) — another actor ran down/suspend against this env while this bring-up was waiting for the control plane. Aborting: the endpoint will never answer because the cluster is going away. This is NOT the reachability gap. The pre-dispatched deploy is cancelled (nothing to deploy onto). Re-run resume once the teardown settles."
}
# poll_until predicate: check the teardown signal FIRST (die-on-detect, via the guard above), then
# probe reachability. Returning non-zero (unreachable, not torn down) lets poll_until retry as before;
# a teardown never returns here — the guard dies straight out of the loop.
_cluster_reachable_or_abort() { _abort_if_teardown_in_progress "$1"; _cluster_reachable; }
# poll_until message hook — module scope (reachable-by-name to shellcheck, no SC2317/SC2329 disable);
# the gap arrives as a forwarded msg_arg ($3), mirroring check-env-active.sh's _cluster_wait_msg.
_cluster_reachable_wait_msg() { echo "GKE control plane not reachable yet (attempt $1/$2) — a fresh apply is ~5-7 min, a deep-suspend resume can take longer as the DNS endpoint propagates; waiting ${3}s…"; }
wait_for_cluster() {
  local attempts="${CLUSTER_REACHABLE_WAIT_ATTEMPTS:-90}" gap="${CLUSTER_REACHABLE_WAIT_GAP:-10}"
  # Fast-fail pre-gate: a genuinely-absent cluster is a real fault — die now (and let the armed CI
  # cancel-trap reap the build, which has nothing to deploy onto) rather than waiting out the window.
  # ds_cluster_present propagates a transient gcloud error under set -e; we tolerate that here (|| true
  # on the sub-check) so a blip doesn't abort — only a confirmed-empty listing fails.
  local cluster; cluster="$(tofu_ output -raw gke_cluster_name 2>/dev/null || true)"
  if [[ -n "$cluster" ]] && ! ds_cluster_present "$cluster" "$PROJECT_ID" "$REGION" 2>/dev/null; then
    die "GKE cluster '$cluster' is not listable in $REGION — it does not exist (apply never created it, or it was deleted). This is a real fault, not the reachability gap; check the GCP console and re-run apply/resume."
  fi
  # No separate pre-gate teardown check: the poll predicate (_cluster_reachable_or_abort) runs
  # _abort_if_teardown_in_progress FIRST on its very first iteration, before any kubectl probe — so a
  # teardown already in flight aborts before the reachability wait begins, without a duplicate probe.
  log "Waiting for GKE cluster control plane to become reachable (fresh apply ~5-7 min; deep-suspend resume can take longer)"
  if ! poll_until -m _cluster_reachable_wait_msg :: "$gap" :: "$attempts" "$gap" -- _cluster_reachable_or_abort "$cluster"; then
    # Reachability timeout ≠ CI-cancel: the cluster EXISTS (pre-gate passed) and its endpoint is just
    # still propagating, so leave the pre-dispatched deploy running (its own waits may carry it home).
    # Clear the cancel-trap BEFORE dying so the die's non-zero exit can't trip it. Same hand-off as
    # _watch_ci_run. No-op when no trap/run is armed (bare `apply`, or DEPLOY_RUN_ID unset).
    trap - EXIT
    die "Cluster '$cluster' not reachable after $((attempts * gap / 60)) minutes — it is RUNNING but the control-plane endpoint never answered kubectl (the deep-suspend DNS-endpoint propagation gap). The pre-dispatched deploy was LEFT RUNNING (follow it: gh run watch). Re-run resume, or raise CLUSTER_REACHABLE_WAIT_ATTEMPTS, if it stays unreachable."
  fi
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
  # export: read by the sourced lib/suspend.sh (shared scope), so mark it used for shellcheck.
  export APP_DOMAIN="$(tfvar app_domain)"
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

# Guard: the GCS state bucket must exist before `tofu init` can initialise the remote backend.
# If `bootstrap` was skipped, init fails with a cryptic "bucket not found" error — check
# explicitly so the message is actionable. Optional $1 overrides the default die message.
require_state_bucket() {
  gcloud storage buckets describe "gs://$STATE_BUCKET" >/dev/null 2>&1 \
    || die "${1:-State bucket gs://$STATE_BUCKET not found — run 'bootstrap' first to create it.}"
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

# _recover_state_lock: guided, interactive recovery for a STUCK OpenTofu state lock — the missing
# counterpart to the preventive wait_for_no_autosuspend_build + -lock-timeout above. Called by
# tofu_locked_ when a tofu op fails to acquire the lock, and directly by the `unlock` command.
#
# Flow (each destructive step is a separate confirm; AUTO_APPROVE=1 skips prompts and only
# proceeds to release when the holder is confirmed DEAD — never force-breaks a live lock unattended):
#   1. Read the .tflock JSON from GCS and print who holds it + how old it is (describe_lock).
#      Empty ⇒ already released (the orphaned-then-reaped case) ⇒ success, retry will proceed.
#   2. Identify + probe liveness of the likely holder:
#        • a QUEUED/WORKING auto-suspend Cloud Build (_ongoing_autosuspend_build_ids), and
#        • the pre-dispatched deploy-gke GH Actions run (DEPLOY_RUN_ID), and
#        • a local `tofu`/`terraform` PID when the lock's host == this machine.
#   3. Offer to kill each identified offender (gh run cancel / gcloud builds cancel / kill).
#   4. If NOTHING was confirmed dead/killed — including when no holder category could even be
#      identified (foreign host, no matching CI run, or a gh/gcloud probe failure) — require an
#      extra "release anyway? this can corrupt state" confirm before releasing. Under
#      AUTO_APPROVE=1 this gate REFUSES outright rather than auto-answering yes.
#   5. Release via `tofu force-unlock -force <ID>` (a 404 = object already gone = success). The
#      state bucket has versioning on (_bootstrap_state_bucket), so a mistaken release is
#      recoverable from a prior state generation — the safety net that makes this acceptable.
# Returns 0 when the lock is released (or was already gone); non-zero when the operator declines,
# so tofu_locked_ re-propagates the original acquire failure unchanged.
# Each holder-probe below reports its verdict by SETTING two globals (not echoing) so its human
# log/ok/warn lines still flow to the terminal instead of being swallowed by a command substitution:
#   PROBE_IDENTIFIED  0|1  — did this probe positively identify its holder category?
#   PROBE_ALIVE       set0 | set1 | keep  — its assignment to holder_alive (keep = leave untouched).
# The orchestrator ORs PROBE_IDENTIFIED across the probes and applies the PROBE_ALIVE assignments IN
# ORDER, reproducing the original inline code's sequential "each block may set holder_alive, later
# blocks win" semantics EXACTLY. This split lets each probe be driven directly from bats; the folding
# invariant (unidentified/alive ⇒ AUTO_APPROVE refuses) is unchanged and pinned by state-lock.bats's
# end-to-end `unlock` tests.

# _probe_holder_build: is an ongoing auto-suspend Cloud Build the likely lock holder? Offers to
# cancel it. set0 iff cancelled (confirmed dead); keep if present-but-not-cancelled or absent.
_probe_holder_build() {
  PROBE_IDENTIFIED=0 PROBE_ALIVE=keep
  local build_id; build_id="$(_ongoing_autosuspend_build_ids | head -1)"
  [[ -n "$build_id" ]] || return 0
  PROBE_IDENTIFIED=1
  warn "An auto-suspend Cloud Build ($build_id) is QUEUED/WORKING — it very likely holds this lock."
  if confirm "Cancel Cloud Build $build_id?"; then
    if gcloud builds cancel "$build_id" --region="$REGION" --project="$PROJECT_ID" >/dev/null 2>&1; then
      ok "cancelled Cloud Build $build_id"; PROBE_ALIVE=set0; return 0
    fi
    warn "could not cancel build $build_id (may have already finished)"
  fi
}

# _probe_holder_gh_run <deploy-run-id>: is the pre-dispatched deploy-gke GH Actions run holding the
# lock? A gh probe FAILURE (auth/network) is treated as "potentially alive" (keep), NOT as finished
# — conflating the two would let a transient gh error read as confirmed-dead. set0 iff cancelled or
# already finished; keep if in_progress-not-cancelled or the probe itself failed.
_probe_holder_gh_run() {
  PROBE_IDENTIFIED=0 PROBE_ALIVE=keep
  local deploy_run_id="${1:-}"
  [[ -n "$deploy_run_id" ]] || return 0
  local gh_rc=0 gh_status
  gh_status="$(gh run view "$deploy_run_id" --json status --jq '.status' 2>/dev/null)" || gh_rc=$?
  if (( gh_rc != 0 )); then
    warn "could not query status of GitHub Actions run $deploy_run_id (gh exited $gh_rc) — treating as potentially alive."
    PROBE_IDENTIFIED=1; return 0
  fi
  PROBE_IDENTIFIED=1
  if [[ "$gh_status" == "in_progress" || "$gh_status" == "queued" ]]; then
    warn "Pre-dispatched deploy-gke run $deploy_run_id is $gh_status."
    if confirm "Cancel GitHub Actions run $deploy_run_id?"; then
      if gh run cancel "$deploy_run_id" >/dev/null 2>&1; then
        ok "cancelled run $deploy_run_id"; PROBE_ALIVE=set0; return 0
      fi
      warn "could not cancel run $deploy_run_id"
    fi
    return 0
  fi
  PROBE_ALIVE=set0  # finished/other terminal status → confirmed not holding the lock
}

# _probe_holder_local_pid <host>: only when the lock was taken on THIS machine — probe (and offer to
# kill) any live local tofu/terraform PID. set0 if the host matches but no live PID exists (confirmed
# dead); set1 if a PID survives or the operator declines to kill it; keep on a foreign host.
_probe_holder_local_pid() {
  PROBE_IDENTIFIED=0 PROBE_ALIVE=keep
  local host="${1:-}"
  [[ -n "$host" && "$host" == "$(hostname)" ]] || return 0
  PROBE_IDENTIFIED=1
  PROBE_ALIVE=set0   # host matches but no live tofu/terraform PID found → confirmed dead by default
  local pids pid; pids="$(pgrep -f "(tofu|terraform).*${TF_DIR}" 2>/dev/null || true)"
  for pid in $pids; do
    # kill -0: probe liveness without signalling. A stale lock's PID is usually already gone.
    if kill -0 "$pid" 2>/dev/null; then
      warn "A local tofu/terraform process (PID $pid) is still alive and may hold this lock."
      if confirm "Kill local process $pid?"; then
        kill "$pid" 2>/dev/null || true; sleep 1
        if kill -0 "$pid" 2>/dev/null && confirm "PID $pid survived SIGTERM — SIGKILL it?"; then
          kill -9 "$pid" 2>/dev/null || true
        fi
        if kill -0 "$pid" 2>/dev/null; then
          warn "PID $pid still alive"; PROBE_ALIVE=set1
        else
          ok "killed PID $pid"
        fi
      else
        PROBE_ALIVE=set1
      fi
    fi
  done
}

_recover_state_lock() {
  local base="gs://$STATE_BUCKET/$STATE_PREFIX" workspace="default"
  local json; json="$(read_tflock "$base" "$workspace")"
  if [[ -z "$json" ]]; then
    ok "No .tflock object present — the lock is already released (nothing to recover)."
    return 0
  fi
  describe_lock "$json"
  # The GCS backend force-unlocks by the .tflock OBJECT GENERATION (a numeric value), NOT the UUID
  # in the JSON "ID" field — passing that UUID fails with "Lock ID should be numerical value". Read
  # the generation here for the release; the JSON "ID" is display-only (already shown by describe_lock).
  local unlock_id who host
  unlock_id="$(tflock_generation "$base" "$workspace")"
  who="$(tflock_field "$json" Who "")"; host="${who##*@}"

  # holder_alive: set when we identify a holder we did NOT kill and that looks (or might be)
  # alive. Starts at 1 — "unknown, assume alive" — NOT 0: if none of the three probes below can
  # positively identify a category (a foreign host with no matching CI run, or a gh/gcloud probe
  # that itself failed rather than cleanly reporting "not running"), we have confirmed NOTHING
  # dead — the lock's actual holder was simply never inspected. Treating unidentified as "dead"
  # would let AUTO_APPROVE=1 force-unlock a possibly-live holder unattended, exactly the
  # concurrent-writer risk this feature exists to prevent. Each probe flips this to 0 only when
  # it POSITIVELY confirms its category is dead/absent/killed; any probe failure or decline to
  # kill leaves it at 1 (a `keep` assignment).
  local holder_alive=1 holder_identified=0 probe
  # Fold the three probes in order (build → deploy run → local PID) so the last positive assignment
  # wins, mirroring the original inline sequence exactly. Each probe sets PROBE_IDENTIFIED/PROBE_ALIVE
  # (its human log lines print normally); we OR identified and apply the alive assignment per probe.
  for probe in \
    "_probe_holder_build" \
    "_probe_holder_gh_run ${DEPLOY_RUN_ID:-}" \
    "_probe_holder_local_pid $host"; do
    PROBE_IDENTIFIED=0 PROBE_ALIVE=keep
    $probe
    (( PROBE_IDENTIFIED )) && holder_identified=1
    case "$PROBE_ALIVE" in
      set0) holder_alive=0 ;;
      set1) holder_alive=1 ;;
      keep) : ;;
    esac
  done

  # No probe could identify ANY holder category (foreign host, no DEPLOY_RUN_ID, no local PID
  # match) — the lock's owner was never inspected, not confirmed dead. Surface this so the
  # operator understands why the stronger "release anyway?" gate below is firing.
  if (( ! holder_identified )); then
    warn "Could not identify the lock holder (no ongoing CI build/run, and Who's host doesn't match this machine) — cannot confirm it is dead."
  fi

  # ── Release ──────────────────────────────────────────────────────────────────────────────
  # AUTO_APPROVE=1 makes `confirm` return 0 unconditionally (see common.sh), which is correct for
  # the "confirmed dead" gate below but must NOT apply to the "release anyway?" gate — that gate
  # exists specifically to stop an unattended release of a lock we could NOT confirm is dead. So
  # under AUTO_APPROVE, a live/unidentified holder refuses outright instead of asking a prompt
  # that would auto-answer yes.
  if (( holder_alive )); then
    warn "The lock holder still looks ALIVE (or could not be confirmed dead). Releasing now can corrupt state (two writers)."
    if [[ "${AUTO_APPROVE:-}" == "1" ]]; then
      warn "AUTO_APPROVE=1 refuses to force-unlock a holder that was not confirmed dead — aborting recovery."
      return 1
    fi
    confirm "Release the state lock ANYWAY?" || { warn "left the lock in place — aborting recovery."; return 1; }
  else
    confirm "Release the state lock now?" || { warn "left the lock in place — aborting recovery."; return 1; }
  fi
  [[ -n "$unlock_id" ]] || { warn "could not read the .tflock object generation — cannot force-unlock; delete ${base}${workspace}.tflock manually."; return 1; }
  # Do NOT swallow force-unlock's stderr: its message is the whole diagnostic when a release fails
  # (e.g. a wrong-ID rejection), and hiding it turns a fixable error into a silent "still locked".
  if tofu_ force-unlock -force "$unlock_id"; then
    ok "state lock (generation $unlock_id) released (bucket versioning is the recovery net if this was in error)."
    return 0
  fi
  # force-unlock fails-with-404 when the .tflock vanished between our read and the release (already
  # reaped) — treat a now-absent object as success regardless of the exit above.
  if [[ -z "$(tflock_generation "$base" "$workspace")" ]]; then
    ok "lock object already gone — treating as released."
    return 0
  fi
  warn "force-unlock failed and the lock object still exists — inspect ${base}${workspace}.tflock manually."
  return 1
}

# unlock: the explicit `run.sh unlock` entry point — run the interactive lock recovery on demand
# without kicking off a full apply/resume. Needs tfvars (for STATE_BUCKET/PROJECT_ID/REGION) and an
# initialised backend before `tofu force-unlock` can address the remote lock. force-unlock itself
# does NOT contend for the lock, so this uses plain tofu_ init and calls the recovery directly.
unlock() {
  ensure_tfvars
  require_state_bucket "State bucket gs://$STATE_BUCKET not found — nothing to unlock."
  tofu_ init -backend-config="bucket=$STATE_BUCKET"
  _recover_state_lock
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

# _clear_plan_file: delete any saved plan (from either working dir). Saved plans contain
# sensitive values, so they must never linger on ANY exit path — success, apply failure, or
# abort. Module-level (not nested in apply()) so both halves of the split — _apply_plan and
# _apply_exec — call the SAME cleanup; resume()'s overlap driver backgrounds _apply_exec, and a
# nested-in-apply() helper would not be in scope there. `die` (common.sh) calls `exit`, which
# bypasses a RETURN trap, and an EXIT trap here would clobber up()'s own EXIT trap — so cleanup
# stays an explicit call at every exit point, not a trap.
_clear_plan_file() { rm -f "$PLAN_FILE" "$TF_DIR/$PLAN_FILE"; }

# apply is split into two halves so the resume path can OVERLAP the cluster-side operator install
# (ESO ‖ Reloader) with the long tail of the apply itself — the Cloud SQL create (~10 min). Within
# one apply OpenTofu already builds module.gke and module.cloudsql as independent DAG branches, so
# the GKE control plane is reachable ~5-7 min in WHILE Cloud SQL is still creating; apply just does
# not RETURN until both finish. suspend.sh's _apply_and_wire_cluster_overlapped runs _apply_plan in
# the foreground (keeps the interactive plan-review gate), then BACKGROUNDS _apply_exec and installs
# the operators the instant the control plane responds — see that function. A second tofu apply
# cannot run concurrently (the state lock is a global mutex), so the overlap is cluster-side work
# (kubectl/helm, no lock) against the single running apply, NOT two applies.
#
#   _apply_plan  — init → reconcile → plan → CONFIRM. Foreground only (interactive review + the
#                  auto-suspend serialise + the provisioning marker). Leaves $PLAN_FILE ready.
#   _apply_exec  — apply that exact plan + the post-apply tail (state prune, IAM cooldown, marker
#                  clear). Safe to background: runs no kubectl, so it never races the kubeconfig.
#
# apply() = _apply_plan → _apply_exec → creds. Byte-for-byte the same behaviour for every existing
# serial caller (up / suspend / apply dispatch / _apply_and_wire); only resume drives the halves
# apart.

# _apply_plan: initialise the backend, heal drift, plan to a file, and get interactive approval.
# Requires the state bucket to exist (bootstrap must have run first). Always plans to a file and
# _apply_exec applies that EXACT plan so there is no drift between the reviewed diff and what
# mutates GCP. `die`s (clearing the marker) on abort. The saved plan is gitignored and short-lived.
_apply_plan() {
  ensure_tfvars
  # Always start from a clean slate: delete any stale plan file so `up`/`apply` ALWAYS
  # regenerate a fresh plan below against current state + tfvars. A leftover plan from a
  # prior run must never be applied — it could no longer match reality.
  _clear_plan_file
  require_state_bucket
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
  # Plan to a file so _apply_exec applies EXACTLY the reviewed diff. A bare `tofu apply` would
  # refresh and create a second plan after confirmation, allowing infrastructure drift between
  # review and mutation. The plan file is local, short-lived, and gitignored. Any reconcile
  # -replace targets are folded into THIS plan so the replacement is reviewed before it mutates GCP.
  # -lock-timeout: wait (don't instantly fail) if the lock is briefly held — covers the
  # residual window where an auto-suspend build starts just after the pre-check above cleared.
  _plan_with_refresh_fallback -lock-timeout=120s ${RECONCILE_REPLACE[@]+"${RECONCILE_REPLACE[@]}"} -out="$PLAN_FILE"
  # The overlapped bring-up paths (resume/up/apply) already took ONE upfront `y` at _confirm_bringup
  # (which set _BRINGUP_CONFIRMED=1) that authorized the WHOLE sequence — the staging apply, the
  # CI dispatch AND this main apply. Re-prompting here would double-ask, so when that flag is set we
  # still PRINT the plan above but skip the prompt. Standalone callers (bare `run.sh apply` with no
  # overlap, suspend, down) never set the flag, so they keep the interactive review gate unchanged.
  if [[ "${_BRINGUP_CONFIRMED:-}" != "1" ]] && ! confirm "Apply this plan? (review the resource changes above)"; then
    _clear_plan_file
    clear_provisioning
    die "aborted before apply"
  fi
}

# _apply_exec: apply the plan _apply_plan produced, then run the post-apply tail. Safe to run in
# the background (resume overlaps it with the operator install) — it touches NO kubeconfig. On
# failure it clears the marker and `die`s; when backgrounded its `die` only kills the subshell, so
# the caller's `wait` captures the non-zero status and re-raises (aborting the bring-up).
_apply_exec() {
  # Assert the saved plan is actually on disk before applying. With `tofu -chdir=$TF_DIR` the
  # -out plan lands at $TF_DIR/$PLAN_FILE, and apply resolves the same path — so a MISSING file here
  # means _apply_plan's plan never persisted OR a concurrent run's _clear_plan_file (rm -f) removed
  # it between plan and apply (both overlap-driven bring-ups and the smoke harness source this file).
  # Without this guard `tofu apply <gone-plan>` fails with a cryptic `stat: no such file or
  # directory` AFTER the operator already answered `y` at the confirm prompt — wasting the review and
  # aborting mid-run. Fail early with an actionable message telling them to re-run the plan instead.
  if [[ ! -f "$TF_DIR/$PLAN_FILE" && ! -f "$PLAN_FILE" ]]; then
    clear_provisioning
    die "saved plan '$PLAN_FILE' is missing (expected at $TF_DIR/$PLAN_FILE) — it never persisted or was cleared by a concurrent run between plan and apply. No GCP mutation happened. Re-run the command to regenerate and apply a fresh plan."
  fi
  if tofu_locked_ apply -lock-timeout=120s "$PLAN_FILE"; then
    _clear_plan_file
    # Force the state history down to STATE_KEEP_VERSIONS the instant the write lands, rather
    # than waiting for the bucket's ~daily lifecycle sweep. Best-effort (never aborts apply):
    # the state is already durably written and the lifecycle rule backstops anything missed.
    # ds_prune_dump_versions (infra/lib/posix/dump.sh, sourced via lib/db.sh) is the shared,
    # unit-tested prune — its <keep-total> arg is STATE_KEEP_VERSIONS (live + noncurrent), and it
    # groups per object path so the multi-object state prefix (default.tfstate, default.tflock, …)
    # keeps STATE_KEEP_VERSIONS per object. Progress goes to stderr (still visible to the operator).
    ds_prune_dump_versions "gs://$STATE_BUCKET/$STATE_PREFIX" "$STATE_KEEP_VERSIONS"
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
}

# apply: the standard serial "plan → apply → fetch creds" used by up / suspend / the `apply`
# dispatch / _apply_and_wire. resume() instead drives _apply_plan + _apply_exec apart to overlap
# the operator install with the apply (see suspend.sh:_apply_and_wire_cluster_overlapped).
apply() {
  _apply_plan
  _apply_exec
  # Only fetch kubectl creds when a cluster exists. use_cluster_soft handles the missing-
  # cluster sentinel (suspended env) AND the post-fetch GKE-context check consistently with
  # every other credential-fetching entry point (eso/reloader/verify-secrets/upgrade-helm/
  # status/logs) — apply() used to duplicate this inline and skip that guard.
  log "Fetching kubectl credentials"
  use_cluster_soft "no cluster (environment suspended) — skipping kubectl credential fetch"
}

# _apply_and_wire: the standard post-bootstrap bring-up tail — apply the plan, wait for the
# control plane, push CI secrets, then print + assert DNS. Single-sourced so the `apply` dispatch
# command and up()'s first-ever (serial) branch can never drift on this sequence. dns_hint prints
# the record; update_dns then asserts it automatically (self-guarding — it warns + falls back to
# the printed hint when creds/IP are missing, so the manual path still works on a first-ever
# bring-up before Spaceship creds are stored).
#
# NO local ESO/Reloader install here (removed 2026-07-06): every caller of _apply_and_wire
# (_apply_with_overlap's two branches, up()'s first-ever branch) calls _predispatch_ci_build
# first, and the dispatched deploy-gke job ALWAYS runs infra/ci/ensure-operators.sh before its
# own apply-infra.sh. A local install here raced the CI job's install against the SAME Helm
# release (same cluster) with no coordination — one side hit "another operation (install/
# upgrade/rollback) is in progress", the other saw the external-secrets namespace as NotFound
# (created-but-not-yet-visible). Nothing between wait_for_cluster and the end of this function
# touches the cluster (secrets() only pushes GitHub Actions secrets/vars from tofu output) or
# needs the ESO CRDs, so there is nothing local left for the operators to unblock — CI's
# apply-infra.sh is the only thing that needs them, and CI installs them itself first.
_apply_and_wire() {
  apply
  # wait_for_cluster (kubectl/gcloud polling, up to ~5-15 min on a from-scratch/deep-suspend
  # resume) and secrets (reads tofu outputs + pushes via `gh` — no cluster/kubectl dependency)
  # touch entirely disjoint subsystems, so run them concurrently instead of paying secrets'
  # cost serialized behind the cluster wait. `wait $pid` surfaces wait_for_cluster's real exit
  # code; secrets stays foreground so its own failures still fail this function directly.
  wait_for_cluster &
  local cluster_wait_pid=$!
  secrets
  wait "$cluster_wait_pid"
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
  gh secret set LIFECYCLE_DEPLOYER_SA     --body "$(tf_out lifecycle_deployer_service_account_email)"
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
    ok "DEPLOYER_SA / LIFECYCLE_DEPLOYER_SA / WORKLOAD_IDENTITY_PROVIDER set as secrets; GCP_PROJECT_ID / APP_DOMAIN / EMAIL_FROM / ENABLE_GITHUB_ATTESTATIONS / BINAUTHZ_* set as variables"
  else
    ok "DEPLOYER_SA / LIFECYCLE_DEPLOYER_SA / WORKLOAD_IDENTITY_PROVIDER set as secrets; GCP_PROJECT_ID / APP_DOMAIN / EMAIL_FROM / ENABLE_GITHUB_ATTESTATIONS set as variables (Binary Authorization disabled — BINAUTHZ_* cleared)"
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
  count_missing "$names" DEPLOYER_SA LIFECYCLE_DEPLOYER_SA WORKLOAD_IDENTITY_PROVIDER || missing=$?
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

# _latest_deploy_run_id: echo the database ID of the most recent deploy-gke.yml run, or nothing.
# Single-sources the `gh run list … -q '.[0].databaseId'` incantation used by deploy() (both the
# before-dispatch snapshot and the after-dispatch poll) and smoke(). Tolerant (`2>/dev/null || true`)
# so a bare command-substitution assignment can't trip `set -e`; callers that need a hard result
# gate on the empty string themselves (smoke does).
_latest_deploy_run_id() {
  gh run list --workflow deploy-gke.yml --limit 1 --json databaseId -q '.[0].databaseId' 2>/dev/null || true
}

# _print_parallel_deploy_hint <infra-word>: the "infra is wired, the deploy is building in parallel,
# here's how to follow it" hand-off block printed identically by up()'s and _apply_with_overlap()'s
# two branches (only the verb differs — "up" vs "applied"). Reads DEPLOY_RUN_ID (may be unset if the
# run ID couldn't be confirmed). Callers that also want the DNS-by-hand note (up's first-ever branch)
# print it themselves after this.
_print_parallel_deploy_hint() {
  log "Infra $1 and the app deploy is building/rolling out in parallel. Follow it:"
  [[ -n "${DEPLOY_RUN_ID:-}" ]] && echo "  gh run watch $DEPLOY_RUN_ID   # build → migrate → rollout"
  echo "  bash infra/run/gcp/run.sh smoke   # wait for CI + verify health endpoint"
}

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
  before_id="$(_latest_deploy_run_id)"
  if [[ "$reason" == "provision" ]]; then
    gh workflow run deploy-gke.yml -f reason=provision
  else
    gh workflow run deploy-gke.yml
  fi
  DEPLOY_RUN_ID=""
  _new_run_appeared() {
    local id
    id="$(_latest_deploy_run_id)"
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

# _apply_ci_identity: apply ONLY the WIF pool/provider + the deployer + lifecycle-deployer SAs and
# their principalSet bindings, PLUS the Artifact Registry repo and the deployer's repo-scoped
# repoAdmin binding — the CI build's SOLE auth prerequisites (WORKLOAD_IDENTITY_PROVIDER /
# DEPLOYER_SA / LIFECYCLE_DEPLOYER_SA — the full SECRETS_REQUIRED_OUTPUTS set _tf_outputs_present
# checks, minus the static app_domain/email_from vars which need no apply) AND the push destination
# build-push.sh's ds_ar_writable gate waits on. This exists so a FIRST-EVER / post-down bring-up (no
# tofu outputs yet) can still overlap the image build with the ~11-min Cloud SQL create, the same
# way the outputs-present branches already do — instead of leaving `deploy` a serial manual step
# behind the full apply.
#
# WHY THE AR REPO + BINDING ARE HERE: both are count=environment_active — destroyed on suspend,
# recreated on resume. Before this, they landed only in the full (untargeted) apply that follows,
# so the pre-dispatched build reached the registry BEFORE the repoAdmin binding existed and sat in
# ds_ar_writable's poll for MINUTES every resume (observed to attempt 29/40, past the step's 8m
# retry timeout, restarting the wait). Landing them in this ~1-min pre-apply means the binding
# exists before the build is even dispatched, so the gate passes on attempt 1 in the common case;
# only the residual IAM→data-plane propagation (build-push.sh's `sleep 5` + a few short polls) remains.
#
# WHY THIS IS SAFE (a targeted apply is normally discouraged as a partial graph): the eight resource
# addresses below reference ONLY string literals + var.project_id/var.github_*/var.region/var.labels
# (verified against modules/iam + modules/artifact-registry) — never var.app_secrets
# (= module.cloudsql/memorystore outputs), var.gke_node_sa_email, or var.binauthz_*. The AR repo
# depends only on google_project_service.apis; the binding depends only on the repo + the deployer SA
# (both targeted here). So `-target` still walks a ~1-min subgraph that pulls in ZERO
# cloudsql/gke/memorystore resources. The secret-VERSION that reads those slow outputs is a DEPENDENT
# of the module, not a dependency of the WIF provider, so it is excluded here and applied by the full
# `apply` that follows. That second apply carries NO -target, applies the COMPLETE graph, and
# reconciles everything — so the final state is whole and consistent. This step only reorders WHEN the
# WIF identity + AR push target land so `secrets` can push and CI can start.
# -auto-approve because it is an internal staging apply, not the reviewed main plan.
#
# KEEP IN SYNC WITH SECRETS_REQUIRED_OUTPUTS: every output that predicate checks must have its
# backing resource targeted here, or the first-ever/post-down path loops forever — _apply_ci_identity
# "succeeds" with no changes, but _tf_outputs_present still fails on the untargeted output, so
# _apply_with_overlap's first-ever branch keeps re-entering this function instead of reaching
# _apply_and_wire's full (untargeted) apply. Hit live 2026-07-06: lifecycle_deployer_service_account_email
# was added to SECRETS_REQUIRED_OUTPUTS without adding its two resources here.
#
# init + the autosuspend-lock coordination mirror apply() — this runs BEFORE it, so it cannot rely
# on apply() having initialised the backend or serialised against the idle-suspend build.
# The AR push target ds_ar_writable gates on: the repo the image is pushed to + the deployer's
# repo-scoped repoAdmin binding that authorizes the push. Shared by _apply_ci_identity (post-down /
# first-ever, where the whole identity is also absent) and _apply_ar_push_target (post-suspend fast
# path, where identity already survives the suspend and only these two were destroyed).
_AR_PUSH_TARGET_ARGS=(
  -target=module.artifact_registry.google_artifact_registry_repository.docker
  -target=module.iam.google_artifact_registry_repository_iam_member.deployer_artifact_registry
)

# _wait_ar_push_ready: block until the deployer SA can ACTUALLY push to the AR repo, then return —
# called by both AR pre-apply helpers right BEFORE they hand off to _predispatch_ci_build.
#
# WHY: the pre-apply's `tofu apply` only returns once google_artifact_registry_repository_iam_member's
# SetIamPolicy call SUCCEEDS, but there is a residual IAM→registry-data-plane propagation lag AFTER
# that (the exact gap build-push.sh's `sleep 5` + short poll absorbs). Worse, the freshly-created
# repo's own IAM subsystem can lag the create by MINUTES, so the provider retries SetIamPolicy for a
# while and the whole pre-apply runs long (observed 8 min on 2026-07-06). Previously we dispatched CI
# the instant the pre-apply returned, racing that propagation against CI's OWN ds_ar_writable poll —
# whose wrapping step retry-timeout can fire before the poll budget is spent, failing the build
# ("not writable yet, attempt 6/40" then step timeout). Move that wait HERE, onto run.sh's clock
# (which has no build-step timeout), so CI is dispatched only once the push identity is genuinely
# usable — the gate passes on attempt 1 in the common case.
#
# Delegates the bounded wait to ds_ar_wait (common.sh) — the SAME poll + probe build-push.sh's CI
# gate uses, so run.sh and CI agree on "writable" and the budget/message live in one place. This
# caller owns only the run.sh-side outcome: a timeout is a non-fatal warn (not die) — the pre-apply
# already succeeded so the binding exists in state; let CI's own poll ride out any remaining lag
# rather than abort the resume. The repo id comes from the artifact_registry_repository_id output
# (static "devstash"), not a hardcoded literal — one source of truth, shared with CI's REPO.
_wait_ar_push_ready() {
  local repo
  repo="$(tf_out artifact_registry_repository_id)"
  if [[ -z "$repo" ]]; then
    warn "artifact_registry_repository_id output empty — skipping the AR-writable dispatch gate; CI's own ds_ar_writable poll will cover it"
    return 0
  fi
  log "Confirming the deployer SA can push to Artifact Registry '$repo' before dispatching CI (covers IAM→registry propagation)"
  if ds_ar_wait "$REGION" "$PROJECT_ID" "$repo"; then
    ok "Artifact Registry '$repo' is writable by the deployer SA — dispatching CI"
  else
    warn "Artifact Registry '$repo' still not writable after the AR-writable wait — dispatching CI anyway; its ds_ar_writable poll will keep waiting on the residual propagation"
  fi
}

# _clear_staging_plan: mirror _clear_plan_file for the staging plan file. Both the CWD-relative and
# the $TF_DIR-relative path are removed because `tofu -chdir` writes the -out plan under $TF_DIR.
_clear_staging_plan() { rm -f "$STAGING_PLAN_FILE" "$TF_DIR/$STAGING_PLAN_FILE"; }

# _staging_apply <label> <target-args…>: the shared pre-apply staging step for the overlap paths.
# It applies a SMALL -target subgraph (WIF/deployer SA/AR repo + push binding) ~1 min BEFORE the main
# apply so CI's build can start while Cloud SQL provisions. Unlike the old blind `apply -auto-approve
# <targets>`, this PLANS to a file, RENDERS that plan to the operator, then applies THAT EXACT file —
# so the staging diff is visible (the plan-first guarantee: you apply only what you reviewed). The one
# upfront consent already came from _confirm_bringup, so this does NOT prompt again; it just shows what
# it is about to create. A no-change plan (everything already exists — e.g. a resume where identity
# survived the suspend) still renders "No changes" and applies as a no-op. init + the autosuspend-lock
# serialise mirror apply(); this runs BEFORE apply() so it cannot rely on that having run.
_staging_apply() {
  local label="$1"; shift
  ensure_tfvars
  require_state_bucket
  wait_for_no_autosuspend_build
  log "Staging apply: $label — planning the pre-apply subgraph so its diff is shown before it mutates GCP"
  tofu_ init -backend-config="bucket=$STATE_BUCKET"
  # Heal state↔cloud drift BEFORE the targeted plan. The staging subgraph front-loads exactly the
  # globally-unique singletons that a partial teardown most often strands (the WIF pool + AR repo):
  # left live in GCP but dropped from state, a bare `tofu plan` tries to CREATE them and the apply
  # dies with a 409 "already exists" (observed on a post-`down` `up` where the -exclude-multiflag
  # destroy had silently no-op'd, leaving both alive). reconcile_state adopts/undeletes them into
  # state so the staging plan sees them as already-managed. It is self-disabling + idempotent, so
  # running it here AND again inside the later full apply (_apply_plan) is harmless. RECONCILE_REPLACE
  # (only the PSC subnet, never in this subgraph) is deliberately not folded into the -target plan.
  reconcile_state
  _clear_staging_plan
  # Plan the -target subgraph to a file, then apply that file — no -auto-approve of an unseen diff.
  tofu_locked_ plan -lock-timeout=120s "$@" -out="$STAGING_PLAN_FILE"
  # If this subgraph targets the app-config secret version, its check block's assertion is
  # expected to show "known after apply" here: the check reads back the SPECIFIC version this
  # resource creates, and that version number doesn't exist yet during a targeted plan that
  # creates/replaces it. It resolves and evaluates for real on the next plan/apply — safe to ignore.
  [[ "$*" == *google_secret_manager_secret_version.app_config* ]] &&
    log "Note: a 'check block assertion known after apply' warning for app_config_version_enabled is expected here — the version doesn't exist yet in this targeted plan; it validates on the next apply."
  log "Staging plan for '$label' shown above — applying it now (already authorised by the bring-up confirmation)"
  tofu_locked_ apply -lock-timeout=120s "$STAGING_PLAN_FILE"
  _clear_staging_plan
}

_apply_ci_identity() {
  # Full CI-auth identity subgraph (WIF pool/provider + deployer & lifecycle SAs + their principalSet
  # bindings) PLUS the AR push target PLUS the app-config secret version — the post-down / first-ever
  # superset. Plans then applies that exact plan via _staging_apply so the diff is visible under the
  # single bring-up consent.
  #
  # The secret-version target closes the version-bump race for the post-down / first-ever path:
  # _predispatch_ci_build (called right after this function by every caller) dispatches the GitHub
  # Actions deploy, whose ESO-sync step (infra/ci/wait-secrets-sync.sh) blocks on the ExternalSecret
  # becoming Ready — which needs an ENABLED app-config version. Applying the version HERE means it
  # exists+enabled BEFORE the deploy is even dispatched, so the ESO wait latches immediately instead
  # of waiting out the apply. This works on THIS path only because the post-down subgraph creates the
  # blob from scratch; a resume's blob depends on Cloud SQL/Memorystore outputs and inherently lands
  # mid-apply (see suspend.sh:_apply_and_wire_cluster_overlapped) — there the ESO wait's 900s timeout
  # is what absorbs the delay. Its dependency (google_storage_hmac_key.uploads → google_service_account
  # .app) is module-local, no Cloud SQL/GKE — so it stays inside the "~1 min, no Cloud SQL" invariant.
  _staging_apply "CI auth identity + AR push target + app-config secret (WIF + deployer SA + repo/binding + secret version)" \
    -target=module.iam.google_iam_workload_identity_pool.github \
    -target=module.iam.google_iam_workload_identity_pool_provider.github \
    -target=module.iam.google_service_account.deployer \
    -target=module.iam.google_service_account_iam_member.github_wif \
    -target=module.iam.google_service_account.lifecycle_deployer \
    -target=module.iam.google_service_account_iam_member.lifecycle_deployer_github_wif \
    -target=module.iam.google_secret_manager_secret_version.app_config \
    "${_AR_PUSH_TARGET_ARGS[@]}"
  # Gate CI dispatch on the deployer SA actually being able to push (repo IAM → registry data-plane
  # propagation can lag the apply return) — see _wait_ar_push_ready.
  _wait_ar_push_ready
}

# _apply_ar_push_target: recreate ONLY the AR repo + deployer repoAdmin binding, ~1 min, BEFORE the
# post-suspend fast path pre-dispatches CI. Both are count=environment_active, so suspend destroyed
# them; unlike the post-down path the WIF identity + deployer SA SURVIVE a suspend, so this targets
# just the two AR resources the build's push needs — not the full identity subgraph. Without it the
# fast path pre-dispatches the build and only recreates the repo/binding inside the main `apply`
# (Cloud SQL + control plane), so the push reaches the registry minutes before the binding lands and
# sits in build-push.sh's ds_ar_writable poll (observed to attempt 29/40, past the step's 8m retry
# timeout). The two -targets reference only string literals + var.project_id/region/labels and
# google_project_service.apis + the (surviving) deployer SA — ZERO cloudsql/gke/memorystore — so the
# ~1-min-subgraph invariant that makes _apply_ci_identity safe holds here too. The full `apply` that
# follows carries no -target and reconciles the complete graph, so the final state stays consistent.
_apply_ar_push_target() {
  # AR-only subgraph (repo + deployer repoAdmin binding) — the post-suspend fast path where identity
  # already survives. Plans then applies that exact plan via _staging_apply so the diff is visible.
  _staging_apply "Artifact Registry repo + deployer push binding" "${_AR_PUSH_TARGET_ARGS[@]}"
  # Gate CI dispatch on the deployer SA actually being able to push (repo IAM → registry data-plane
  # propagation can lag the apply return) — see _wait_ar_push_ready.
  _wait_ar_push_ready
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
  local rc=0         # pre-declared so the trap's `rc=$?` reads as an in-scope assignment (no SC2154)
  [[ -n "${DEPLOY_RUN_ID:-}" ]] || return 0
  # shellcheck disable=SC2064  # DELIBERATE: expand DEPLOY_RUN_ID + phase NOW (fixed at arm time), so the trap captures the run to cancel even if the vars change later.
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

# _confirm_bringup <up|resume|apply>: the SINGLE upfront intent gate for the three overlapped
# bring-up paths. Those paths deliberately FRONT-LOAD GCP mutation — a staging `tofu apply
# -auto-approve` (WIF pool/provider + deployer & lifecycle SAs + their IAM bindings + the Artifact
# Registry repo + push binding), a GitHub-secrets push, and a real `deploy-gke` CI dispatch — so the
# ~1-min identity/AR create and the image build OVERLAP the ~10-min Cloud SQL create. That overlap is
# kept; this gate just makes it happen only AFTER one explicit `y`. Without it a `resume`/`up`/`apply`
# creates AR/SAs/WIF and dispatches a build BEFORE the operator ever sees a plan (observed live: an
# aborted resume left an AR repo, SAs, WIF and pushed images behind). On decline we `die` before ANY
# mutation. On accept we set _BRINGUP_CONFIRMED=1, which _apply_plan reads to SUPPRESS its own
# now-redundant "Apply this plan?" prompt (the plan is still printed) — so there is exactly ONE
# interactive confirmation per invocation. AUTO_APPROVE=1 makes confirm() return 0 without reading
# stdin (common.sh), so the CI/UI path stays non-interactive and the flag is still set. The flag is
# a plain (non-exported) global: _apply_plan reads it in this same shell, and NOT exporting it keeps
# it out of the backgrounded overlap-apply subshells so it can never leak a suppressed prompt there.
_confirm_bringup() {
  local phase="$1"
  log "'$phase' will provision GCP. It runs, IN THIS ORDER, once you confirm:"
  log "  1. a staging apply: WIF pool/provider, deployer + lifecycle SAs + IAM bindings, Artifact Registry repo + push binding"
  log "  2. push GitHub Actions secrets, then DISPATCH the deploy-gke CI run (builds + pushes images)"
  log "  3. the full 'tofu apply': Cloud SQL, GKE, Memorystore, Cloud NAT/Armor, ingress IP — the reviewed plan is printed before it applies"
  warn "Steps 1-2 begin creating GCP resources IMMEDIATELY after you confirm — there is no separate prompt before them."
  confirm "Proceed with '$phase'? (nothing has touched GCP yet)" || die "aborted before any GCP changes"
  _BRINGUP_CONFIRMED=1
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
# outputs are ABSENT (a first-ever apply before any provision), the build's only auth prerequisites
# (WIF provider + deployer SA) still have no dependency on Cloud SQL, so that branch applies JUST
# those first (_apply_ci_identity, ~1 min), then pre-dispatches and overlaps the full apply — the
# same overlap as above, no longer a serial "deploy is a manual next step". Gating on OUTPUTS (not
# stale GitHub secrets) matches up()/resume().
_apply_with_overlap() {
  _confirm_bringup apply            # single upfront gate — nothing below touches GCP until confirmed
  if _tf_outputs_present; then
    log "Tofu outputs present — pre-dispatching deploy so its build overlaps apply"
    _predispatch_ci_build          # secrets refresh → deploy provision; sets DEPLOY_RUN_ID
    _arm_ci_cancel_trap apply      # cancel the run if apply dies before the handoff below
    _apply_and_wire
    trap - EXIT   # infra is wired; the run now owns its own success/failure — stop cancelling it
    _print_parallel_deploy_hint applied
    return 0
  fi
  # First-ever apply (no tofu outputs yet): apply the WIF identity first so the build overlaps the
  # full apply below, exactly like the outputs-present branch. _apply_ci_identity applies a
  # Cloud-SQL-free -target subgraph; _apply_and_wire then applies the complete graph (no -target)
  # and re-runs `secrets` idempotently once the full outputs exist, so the final state is consistent.
  log "No tofu outputs (first-ever apply) — applying WIF identity first so the build overlaps apply"
  _apply_ci_identity             # ~1 min: WIF provider + deployer SA now exist
  _predispatch_ci_build          # secrets (identity outputs readable now) → deploy provision; sets DEPLOY_RUN_ID
  _arm_ci_cancel_trap apply      # cancel the run if apply dies before the handoff below
  _apply_and_wire                # full apply: Cloud SQL + GKE + secret-version, in parallel with the build
  trap - EXIT   # infra is wired; the run now owns its own success/failure — stop cancelling it
  _print_parallel_deploy_hint applied
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
  run_id="$(_latest_deploy_run_id)"
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

# down (full teardown) + its private helpers empty_bucket / force_release_psa live in lib/suspend.sh
# (sourced below), beside the cleanup_leaked_negs/cleanup_builds teardown family they call into.

# ── suspend / resume (on-demand showcase) ───────────────────────────────────
# The DB dump/restore (resolve_dump_target/dump_db/restore_db), DNS (spaceship_api/update_dns/
# set_dns_creds/dns_hint), and the suspend/resume orchestrators (set_active_state/suspend/
# resume) live in lib/db.sh, lib/dns.sh, and lib/suspend.sh — all sourced above and sharing
# this shell's scope.

# up: full bring-up — bootstrap → apply → cluster-side wiring → DNS. Like `resume`, it PRE-
# DISPATCHES the deploy-gke workflow (whose cluster-independent build-push job then builds +
# pushes WHILE `apply` provisions Cloud SQL ~10 min + the control plane). When the tofu outputs
# `secrets` reads already exist (_tf_outputs_present), it pre-dispatches straight away. On a first-
# ever `up`, or an `up` after a `down` erased the outputs, they do NOT — but the build's only real
# prerequisites (WIF provider + deployer SA) have no dependency on Cloud SQL, so that branch now
# applies JUST those first (_apply_ci_identity, ~1 min), pushes secrets, pre-dispatches, THEN runs
# the full apply in parallel — the same overlap, no longer a serial "deploy is a manual next step".
# Gating on the OUTPUTS (not stale GitHub secrets, which can outlive the `down` that erased the
# outputs) mirrors resume(). Unlike `resume`, `up` also runs `bootstrap` (project/billing/state/
# APIs), no DB restore.
up() {
  preflight
  bootstrap                        # its own _confirm_bootstrap gate — distinct GCP scope (project/billing/bucket/APIs)
  _confirm_bringup up              # single upfront gate for the provision/overlap below — nothing touches GCP until confirmed
  if _tf_outputs_present; then
    log "Tofu outputs present — pre-dispatching deploy so its build overlaps apply"
    # Same overlap + cancel-on-early-exit pattern as resume(): pre-dispatch CI (secrets refresh →
    # deploy provision) so build-push runs WHILE apply provisions, arm the cancel trap so an early
    # exit reaps the orphaned run, then apply in parallel. Both steps single-sourced above.
    _predispatch_ci_build          # sets DEPLOY_RUN_ID
    _arm_ci_cancel_trap up         # cancel the run if anything below dies before the handoff
    apply
    wait_for_cluster
    # NO local ESO/Reloader install — the pre-dispatched deploy job's ensure-operators.sh
    # installs them before its own apply-infra.sh; see _apply_and_wire's comment for why a
    # local install here would race CI's install against the same Helm release.
    trap - EXIT   # cluster is up; the run now owns its own success/failure — stop cancelling it
    dns_hint; update_dns
    _print_parallel_deploy_hint up
    return 0
  fi
  # First-ever bring-up, or an `up` after a `down` (no tofu outputs yet). The tofu outputs
  # `secrets` needs don't exist, so we can't pre-dispatch CI straight away — but the build's ONLY
  # real prerequisites (WIF + deployer SA) have no dependency on the ~11-min Cloud SQL create. So
  # apply JUST that identity first (_apply_ci_identity, ~1 min), push secrets, pre-dispatch the
  # build, then run the full apply→wait→eso→secrets→dns tail in parallel — the same overlap the
  # outputs-present branch above gets. _apply_and_wire re-runs `secrets` (idempotent) once the full
  # outputs exist, so the DB/binauthz/AR values omitted by the identity-only apply land then.
  log "No tofu outputs (first-ever / post-down) — applying WIF identity first so the build overlaps apply"
  _apply_ci_identity             # ~1 min: WIF provider + deployer SA now exist
  _predispatch_ci_build          # secrets (identity outputs readable now) → deploy provision; sets DEPLOY_RUN_ID
  _arm_ci_cancel_trap up         # cancel the run if anything below dies before the handoff
  _apply_and_wire                # full apply: Cloud SQL + GKE + secret-version, in parallel with the build
  trap - EXIT   # infra is wired; the run now owns its own success/failure — stop cancelling it
  _print_parallel_deploy_hint up
  echo "  (If the DNS A-record was not set automatically — creds missing — add it by hand.)"
}

# ── dispatch ───────────────────────────────────────────────────────────────
# Only dispatch when EXECUTED as a script, not when SOURCED. bats unit tests source this file to
# drive individual functions (e.g. _confirm_bringup) directly without triggering a command run;
# every real invocation (`bash run.sh <cmd>`, the CI/UI paths) executes it, where BASH_SOURCE[0]
# equals $0 and the case below runs exactly as before. Guarding is a no-op for execution.
if [[ "${BASH_SOURCE[0]}" == "${0}" ]]; then
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
  unlock)          unlock ;;
  *) die "unknown command '$CMD' — one of: up | bootstrap | apply | eso | reloader | secrets | verify-secrets | rotate-secret | upgrade-helm | deploy | smoke | status | logs | suspend | resume | dump-db | restore-db | update-dns | set-dns-creds | down | unlock" ;;
esac
fi
