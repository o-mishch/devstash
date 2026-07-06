# shellcheck shell=bash
# Shared bash helpers for the DevStash deploy tooling. SOURCED (never executed) so the
# Artifact Registry image coordinates live in exactly one place, consumed identically by
# infra/run/gcp/run.sh (laptop bootstrap) and infra/ci/*.sh (GitHub Actions steps).
#
# NOT usable from infra/terraform/envs/dev/scripts/*.sh — those are Cloud Build /bin/sh
# substitution templates ($_VAR / $$), a different dialect that runs inside a container
# with no access to this repo file. Those scripts mirror the string below by necessity;
# if the image path formula ever changes, update them in lockstep.
#
# Source-guard: sourcing twice (e.g. run.sh sources it, then calls a CI script that also
# sources it in the same process) is a harmless no-op.
[[ -n "${_DEVSTASH_COMMON_SH:-}" ]] && return 0
_DEVSTASH_COMMON_SH=1

# ── Presentation + preflight primitives ─────────────────────────────────────
# Generic, cloud-agnostic helpers shared by both run.sh orchestrators (gcp-run + local-run).
# Kept here so the two scripts speak ONE logging/preflight vocabulary instead of each
# reimplementing it (gcp-run used to own these; local-run used bare `echo`). No GCP coupling.
log()  { printf '\n\033[1;36m▶ %s\033[0m\n' "$*"; }
ok()   { printf '\033[0;32m  ✓ %s\033[0m\n' "$*"; }
warn() { printf '\033[0;33m  ! %s\033[0m\n' "$*"; }
die()  { printf '\033[0;31m✗ %s\033[0m\n' "$*" >&2; exit 1; }

# need <cli> <install-hint>: assert a required CLI is on PATH, else die with the hint.
# Callers build their own tool list (each script needs a different set) and call need per tool.
need() { command -v "$1" >/dev/null 2>&1 || die "missing required CLI: $1 ($2)"; }

# confirm <prompt>: interactive y/N gate. AUTO_APPROVE=1 skips the prompt entirely (scripted/
# CI use). Only y/Y/n/N (and Enter = default No) are accepted; anything else re-prompts rather
# than silently aborting — a stray keystroke (e.g. a wrong keyboard layout) must not read as
# decline.
confirm() {
  [[ "${AUTO_APPROVE:-}" == "1" ]] && return 0
  local reply
  while true; do
    read -r -p "$1 [y/N] " reply || return 1
    case "$reply" in
      y | Y) return 0 ;;
      n | N | "") return 1 ;;
      *) warn "Please answer y or N." ;;
    esac
  done
}

# read_secret <prompt> <out-var-name>: read a credential into the named variable WITHOUT echoing
# it — a hidden `read -s` prompt on a tty, or a plain line from stdin when piped (automation).
# Single-sources the "never let a secret reach shell history or the process list" input idiom that
# rotate_secret (run.sh) and set_dns_creds (dns.sh) both need. Uses `printf -v` to assign the
# caller's variable by name (no eval, no nameref — portable to the Helm-3/bash-3 CI runner too).
read_secret() {
  local _prompt="$1" _out="$2" _val
  if [[ -t 0 ]]; then
    read -r -s -p "$_prompt" _val; printf '\n'
  else
    read -r _val
  fi
  printf -v "$_out" '%s' "$_val"
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

# count_missing "<newline-list>" item…: for each item, ok if present in the list (exact-line
# match) else warn "MISSING". Returns the count of missing items so callers can gate on it —
# capture with `count_missing … || missing=$?` (the non-zero return would otherwise trip set -e).
count_missing() {
  local have="$1"; shift
  local n=0 item
  for item in "$@"; do
    # -qxF + --: fixed-string, whole-line match, metachar-safe.
    if printf '%s\n' "$have" | grep -qxF -- "$item"; then
      ok "$item"
    else
      warn "MISSING: $item"
      n=$((n + 1))
    fi
  done
  return "$n"
}

# require_kube_context <expected-glob> <fix-hint>: die if the CURRENT kubectl context does
# not match <expected-glob> (a glob, so the GCP caller can match "gke_*_devstash-*-gke" without
# hardcoding the project id). Guards against exactly the failure mode that motivated this: GCP's
# `run.sh apply` calls `gcloud container clusters get-credentials`, which switches kubectl's
# context to GKE and LEAVES IT THERE — a subsequent `local run.sh up` then silently applies the
# local-only backing-services base (Postgres/Redis/MinIO pods) onto the real GKE dev cluster,
# since kubectl has no cluster-type awareness and `kubectl apply` never asks "are you sure".
# Call this as the first line of every kubectl-mutating entry point (both run.sh `up`, `deploy`,
# `apply`, etc.) — never rely on preflight alone, since preflight only checks CLI presence.
require_kube_context() {
  local expected="$1" hint="$2" current
  current="$(kubectl config current-context 2>/dev/null || true)"
  [[ -n "$current" ]] || die "no active kubectl context — $hint"
  # shellcheck disable=SC2053  # intentional glob match, not literal string compare
  [[ "$current" == $expected ]] || die "kubectl context is '$current', expected to match '$expected' — $hint"
  ok "kubectl context: $current"
}

# ssa_apply <yq-select-expr>: server-side apply the subset of /tmp/rendered.yaml matched by
# <yq-select-expr>, under the STABLE field manager devstash-deploy with --force-conflicts. The
# split-apply CI steps run this on complementary slices of the SAME render: apply-infra.sh on
# 'select(.kind != "Deployment")' (everything but the web Deployment) and rollout-web.sh on
# 'select(.kind == "Deployment")' (the web Deployment only), AFTER migrations land. Kept here so
# the field-manager name + the --server-side/--force-conflicts flag set are single-sourced and
# can never drift between the two applies (they must match for the CSA→SSA ownership transfer to
# be a genuine one-time move). The full rationale for --force-conflicts and the dedicated
# field-manager lives in the apply-infra.sh header. Assumes /tmp/rendered.yaml exists (written
# once by render-manifests.sh) and that yq + kubectl are on PATH.
ssa_apply() {
  yq "$1" /tmp/rendered.yaml \
    | kubectl apply --server-side --force-conflicts --field-manager=devstash-deploy -f -
}

# ds_health_ok <url>: 0 iff the deep health endpoint at <url> reports {"status":"ok"}. Encodes
# the app's health contract in ONE place for both orchestrators — HTTP 200 alone is NOT healthy:
# the endpoint can return 200 with {"status":"error","db":"…"} while a backing service (Cloud SQL
# / Postgres / Redis / MinIO) is still coming up, so `curl -sf` (status-only) and `jq .` (any
# valid JSON) both false-pass. `jq -e '.status == "ok"'` exits non-zero on a false/null result so
# the caller keeps polling. gcp/run.sh's _app_healthy polls it silently against https; local
# run.sh's deep_health_check prints the body first, then asserts the verdict via this predicate.
ds_health_ok() {
  curl -sf --max-time 10 "$1" | jq -e '.status == "ok"' >/dev/null 2>&1
}

# The container images this project builds and deploys — declared once so adding or renaming
# an image is a single edit shared by every script that sources this library (the builder in
# build-push.sh). The deep-suspend path no longer needs this list: it deletes the whole
# Artifact Registry repo rather than looping individual images.
# shellcheck disable=SC2034  # consumed by scripts that source this library, not here
DEVSTASH_IMAGES=(web migrate)

# The k8s namespace every CI script targets (base kustomize; matches settings.yaml). Declared
# once so a namespace rename is a single edit instead of updating each script's local `NS=`.
# shellcheck disable=SC2034  # consumed by scripts that source this library, not here
DEVSTASH_NS=devstash

# ds_image_base <region> <project> <repo>: the Artifact Registry repo path that every
# devstash image hangs off (e.g. us-central1-docker.pkg.dev/<project>/devstash). Kept here
# so build-push.sh derives it identically to the rest of the tooling.
ds_image_base() {
  printf '%s-docker.pkg.dev/%s/%s' "$1" "$2" "$3"
}

# ds_newest_enabled_secret_version + ds_access_secret_blob — the newest-state:ENABLED secret read
# (the "avoid `access latest`" hardening) now lives in infra/lib/posix/secrets.sh, single-sourced
# with the unattended Cloud Build secret fetch (scripts/auto-suspend-prepare.sh, which mirrored it
# by hand until now). bash sources the POSIX file transparently, so run.sh's app-config read, dns.sh's
# ops-config read, and wait-secrets-sync.sh lose nothing; prepare.sh layers its own FATAL wrapper on
# ds_newest_enabled_secret_version (it MUST have the secret, unlike these tolerant reads).
# shellcheck source=infra/lib/posix/secrets.sh
source "$(dirname "${BASH_SOURCE[0]}")/posix/secrets.sh"

# helm_release_at_version <release> <namespace> <expected-chart>: exit 0 iff <release> is
# deployed in <namespace> at exactly <expected-chart> (e.g. "external-secrets-0.20.0"),
# else non-zero. Lets the ensure-*.sh installers short-circuit an already-current release
# without each repeating the helm-list/jq probe. A missing jq or helm returns non-zero so
# the caller proceeds with the install rather than falsely reporting "already installed".
helm_release_at_version() {
  command -v jq >/dev/null 2>&1 && command -v helm >/dev/null 2>&1 || return 1
  local current
  current="$(helm list -n "$2" -o json 2>/dev/null \
    | jq -r --arg r "$1" '.[] | select(.name==$r and .status=="deployed") | .chart' 2>/dev/null || true)"
  [[ "$current" == "$3" ]]
}

# helm_failure_policy: echo the Helm failure flag, honouring a caller override. CRITICAL: the
# default MUST stay "--atomic" — the GitHub Actions runner (ubuntu-latest) ships Helm 3, which
# does NOT support "--rollback-on-failure" and fails the build; "--atomic" works on both Helm 3
# and Helm 4 (deprecated but functional). Local run.sh runs modern Helm and exports
# HELM_FAILURE_POLICY="--rollback-on-failure" (the non-deprecated flag) to override. One source
# of truth for the default so ensure-eso.sh and ensure-reloader.sh never drift.
helm_failure_policy() { printf '%s' "${HELM_FAILURE_POLICY:---atomic}"; }

# helm_skip_if_current <release> <namespace> <expected-chart> <label>: print the "already
# installed" line and exit 0 iff <release> is deployed at exactly <expected-chart> (e.g.
# "external-secrets-0.20.0"). Wraps helm_release_at_version with the identical skip-or-proceed
# boilerplate both ensure-*.sh installers repeat verbatim. The version shown is derived from the
# chart string (everything after the last '-'), so the message stays single-sourced too.
# NOTE: this calls `exit 0` in the CALLER's shell — it is meant to be invoked at top level of an
# installer script, not inside a subshell/pipeline.
helm_skip_if_current() {
  if helm_release_at_version "$1" "$2" "$3"; then
    echo "$4 version ${3##*-} is already installed. Skipping Helm upgrade."
    exit 0
  fi
}

# helm_repo <name> <url>: register (idempotent — ignore the "already exists" warning on re-add) +
# refresh a single Helm chart repo. Output is silenced because the add/update result is not
# diagnostic — a real failure surfaces at the subsequent `helm upgrade --install` (and `helm repo
# update` still propagates its exit code under set -e; only stdout is redirected). Single-sourced
# here so upgrade_helm (gke.sh, freshens both repos) and the ensure-eso.sh / ensure-reloader.sh CI
# installers all register a repo the same way instead of each open-coding the add+update pair.
helm_repo() {
  helm repo add "$1" "$2" >/dev/null 2>&1 || true
  helm repo update "$1" >/dev/null
}

# ds_cluster_present <cluster> <project> <region>: 0 iff <cluster> is listable in GKE. A `list`
# filtered to the exact name returns the name (non-empty) when present, empty when absent. Does
# NOT swallow a `gcloud list` failure — it propagates under the caller's `set -e`, matching
# decide-build.sh's documented contract (a genuine API error must fail loudly, not be misread as
# "absent"). check-env-active.sh wraps this in a poll loop and swallows at ITS call site instead
# (`ds_cluster_present ... || true`), because there a transient error should retry, not abort.
ds_cluster_present() {
  local cluster="$1" project="$2" region="$3" found
  found="$(gcloud container clusters list \
    --project "$project" --region "$region" \
    --filter="name=$cluster" --format='value(name)')"
  [[ -n "$found" ]]
}

# ds_ar_writable <region> <project> <repo>: 0 iff the Artifact Registry repo EXISTS and its IAM
# policy grants the CALLING identity (the WIF-federated deployer SA in CI) a role that carries
# artifactregistry.repositories.uploadArtifacts — i.e. the push will authorize. Guards the
# resume/first-apply RACE: run.sh PRE-DISPATCHES deploy-gke so build-push overlaps `tofu apply`,
# but the repo AND the deployer's repo-scoped repoAdmin binding are count=environment_active —
# destroyed on suspend, RECREATED partway through that still-running apply. Pushing before the
# binding lands (or before it propagates to the registry data plane) is the exact
# "denied: ...uploadArtifacts" failure this probe polls away. Checks, in order:
#   1. repo describe succeeds       — the repo has been recreated (else 404 → not yet),
#   2. its IAM policy lists our SA against roles/artifactregistry.{repoAdmin,writer,admin}
#      — the write binding has been applied (a bare repo with no binding still can't push).
# gcloud has no `test-iam-permissions` for artifacts, so we read the policy and match our own
# member. `gcloud config get account` is the identity gcloud will mint the push token for (the
# impersonated deployer SA under WIF), so matching it against the policy is faithful to the push.
# All failures are swallowed to a non-zero return so the CALLER's poll loop retries rather than
# aborting under set -e — same tolerant-probe contract as check-env-active.sh wraps ds_cluster_present.
# A brief settle after this returns true still guards raw data-plane propagation (see build-push.sh).
ds_ar_writable() {
  # repo_id (not `repo`): a lowercase `repo` local would make shellcheck -x, following this source
  # into the CI scripts, flag every uppercase $REPO env use (prune-registry.sh, build-push.sh) as a
  # possible-misspelling SC2153 — those are legit workflow-provided vars, so keep the name distinct.
  local region="$1" project="$2" repo_id="$3" account members
  gcloud artifacts repositories describe "$repo_id" \
    --project "$project" --location "$region" >/dev/null 2>&1 || return 1
  account="$(gcloud config get-value account 2>/dev/null)" || return 1
  [[ -n "$account" ]] || return 1
  # Bindings that include uploadArtifacts. writer/repoAdmin are the scoped grants this repo uses;
  # admin is included for completeness (a project-wide artifactregistry.admin would also authorize).
  members="$(gcloud artifacts repositories get-iam-policy "$repo_id" \
    --project "$project" --location "$region" \
    --flatten='bindings[].members' \
    --filter='bindings.role:(roles/artifactregistry.repoAdmin OR roles/artifactregistry.writer OR roles/artifactregistry.admin)' \
    --format='value(bindings.members)' 2>/dev/null)" || return 1
  printf '%s\n' "$members" | grep -qxF "serviceAccount:$account"
}

# ds_dump_job_diagnostics <namespace> <job-name>: best-effort logs + describe for a failed/timed-out
# Job, printed right before the caller exits 1. Kept here so the two identical dumps inside
# run-migrations.sh (Failed condition vs. deadline exceeded) can't drift from each other.
ds_dump_job_diagnostics() {
  local ns="$1" job="$2"
  kubectl -n "$ns" logs "job/$job" --tail=200 || true
  kubectl -n "$ns" describe "job/$job" || true
}

# wait_for_job_gate <namespace> <job> <deadline-secs>: poll a gated Job's terminal conditions and
# return a distinct code so the caller keeps its own wording/exit style. Watches BOTH Complete and
# Failed each tick — `kubectl wait --for=condition=complete` only tracks one condition and so burns
# the full deadline on an already-Failed Job before diagnostics run. Returns 0 on Complete, 1 on
# Failed, 2 on timeout; on 1/2 it runs ds_dump_job_diagnostics FIRST so the post-mortem is emitted
# once here rather than duplicated at every call site. Single-sources the migrate→rollout gate loop
# that CI (run-migrations.sh, `::error::`/exit) and local run.sh (`die`) each wrap with their own
# message — the only differences between the two were the deadline and that wording.
wait_for_job_gate() {
  local ns="$1" job="$2" deadline=$(( SECONDS + $3 )) complete="" failed=""
  while (( SECONDS < deadline )); do
    complete="$(kubectl -n "$ns" get job "$job" \
      -o jsonpath='{.status.conditions[?(@.type=="Complete")].status}' 2>/dev/null)"
    [[ "$complete" == "True" ]] && return 0
    failed="$(kubectl -n "$ns" get job "$job" \
      -o jsonpath='{.status.conditions[?(@.type=="Failed")].status}' 2>/dev/null)"
    if [[ "$failed" == "True" ]]; then
      ds_dump_job_diagnostics "$ns" "$job"
      return 1
    fi
    sleep 5
  done
  ds_dump_job_diagnostics "$ns" "$job"
  return 2
}

# GCS object-version pruning ("cap the history NOW" — the complement to the bucket's async
# lifecycle rule) lives in ds_prune_dump_versions (infra/lib/posix/dump.sh), the ONE POSIX-portable,
# unit-tested implementation shared by BOTH the bash laptop path (run.sh state prune + db.sh dump
# prune, which source dump.sh) and the /bin/sh Cloud Build path (auto-suspend-dump.sh). This file
# used to carry a bash-only near-duplicate (gcs_prune_versions); it was removed so the two can never
# drift on the delete logic. bash sources the POSIX file transparently, so run.sh loses nothing.
