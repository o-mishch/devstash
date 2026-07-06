# shellcheck shell=bash
# Shared bash helpers for the DevStash deploy tooling. SOURCED (never executed) so the
# Artifact Registry image coordinates live in exactly one place, consumed identically by
# infra/run/gcp/run.sh (laptop bootstrap) and infra/ci/*.sh (GitHub Actions steps).
#
# NOT usable from infra/terraform/envs/dev/scripts/*.sh — those are Cloud Build /bin/sh
# substitution templates ($_VAR / $$), a different dialect that runs inside a container
# with no access to this repo file. Where those scripts genuinely need this library's logic
# they git-clone the repo and `.`-source the POSIX helpers in infra/lib/posix/ (see e.g.
# auto-suspend-prepare.sh sourcing secrets.sh) — NOT a hand-copied mirror. The image-path
# formula (ds_image_base) has no /bin/sh consumer at all: its only callers are the bash CI
# scripts (build-push.sh, prune-registry.sh) that source this file, and the deep-suspend path
# deletes the whole Artifact Registry repo rather than reconstructing per-image paths.
#
# Source-guard: sourcing twice (e.g. run.sh sources it, then calls a CI script that also
# sources it in the same process) is a harmless no-op.
[[ -n "${_DEVSTASH_COMMON_SH:-}" ]] && return 0
_DEVSTASH_COMMON_SH=1

# ── Presentation + preflight primitives ─────────────────────────────────────
# Generic, cloud-agnostic helpers shared by both run.sh orchestrators (gcp-run + local-run).
# Kept here so the two scripts speak ONE logging/preflight vocabulary instead of each
# reimplementing it (gcp-run used to own these; local-run used bare `echo`). No GCP coupling.
#
# _ts_tag: when a caller has opened a timed span (via begin_span, below) this emits an
# "HH:MM:SS +Ns " lead-in for every log/ok/warn line, so the interleaved output of a
# long concurrent orchestration (resume) carries wall-clock + elapsed on every line. When no
# span is open (_SPAN_T0 unset — the default for every other caller) it emits nothing, so the
# plain log/ok/warn output is byte-for-byte unchanged. SECONDS is bash's monotonic
# second-counter, already the elapsed-time idiom in this codebase (run.sh:wait_* loops). It does
# fork one `date` per tagged line for the wall-clock stamp — negligible: only the handful of
# narration lines emitted while a span is open pay it.
_ts_tag() {
  [[ -n "${_SPAN_T0:-}" ]] || return 0
  printf '%s +%s ' "$(date +%H:%M:%S)" "$(fmt_dur "$(( SECONDS - _SPAN_T0 ))")"
}
log()  { printf '\n\033[1;36m▶ %s%s\033[0m\n'   "$(_ts_tag)" "$*"; }
ok()   { printf '\033[0;32m  ✓ %s%s\033[0m\n'   "$(_ts_tag)" "$*"; }
warn() { printf '\033[0;33m  ! %s%s\033[0m\n'   "$(_ts_tag)" "$*"; }
die()  { printf '\033[0;31m✗ %s%s\033[0m\n' "$(_ts_tag)" "$*" >&2; exit 1; }

# ── Timed-span + stage narration (opt-in; used by the resume overlap driver) ─────────────────
# fmt_dur <seconds>: humanise an elapsed second-count as "9m52s" / "44s" / "1h03m". Pure bash
# arithmetic, no external process (this function alone) — cheap to call on every per-path join.
fmt_dur() {
  local s="$1"
  if   (( s < 60 ));   then printf '%ds' "$s"
  elif (( s < 3600 )); then printf '%dm%02ds' "$(( s / 60 ))" "$(( s % 60 ))"
  else                      printf '%dh%02dm' "$(( s / 3600 ))" "$(( (s % 3600) / 60 ))"
  fi
}

# begin_span <total>: open a timed narration span. Records the current SECONDS as the span origin
# so _ts_tag can render "+elapsed" against it, resets the stage counter, and stashes the stage
# TOTAL so each `stage` call carries the denominator without the caller repeating it (one number,
# one place — the count can't drift across call sites when a stage is inserted/removed). Idempotent-
# ish: a second call just re-anchors. end_span closes it (log/ok/warn go back to plain). The span is
# process-local state — a backgrounded subshell inherits the origin at fork time (correct: children
# timestamp against the same t0) but its own begin/end never leaks back out.
begin_span() { _SPAN_T0="$SECONDS"; _SPAN_STAGE=0; _SPAN_TOTAL="${1:-?}"; }
end_span()   { unset _SPAN_T0 _SPAN_STAGE _SPAN_TOTAL; }

# stage <text>: a numbered stage banner within an open span — "[stage 3/6] <text>". Auto-increments
# a per-span counter and reads the total set by begin_span, so callers pass ONLY the text — never a
# hand-maintained index (drifts when a stage is inserted) NOR a repeated total (drifts across call
# sites). No-op-safe outside a span: it still prints, total shown as "?". Routed through log() so it
# inherits the _ts_tag.
stage() {
  _SPAN_STAGE=$(( ${_SPAN_STAGE:-0} + 1 ))
  log "[stage ${_SPAN_STAGE}/${_SPAN_TOTAL:-?}] $*"
}

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

# ── OpenTofu/Terraform state-lock primitives (GCS backend) ──────────────────
# The GCS backend stores a held lock as a JSON object at <prefix>/<workspace>.tflock next to
# the state, created with an if-generation-match:0 precondition. Its fields mirror the
# "Error acquiring the state lock" box: ID, Operation, Who (user@host), Version, Created, Info,
# Path. These three helpers let the orchestrators inspect a stuck lock and drive an interactive
# recovery (see run.sh:_recover_state_lock) instead of dying on the raw error. Cloud-specific
# reads live here alongside the other gcloud helpers (gcs_prune_versions, ds_access_secret_blob).

# is_lock_error <captured-tofu-output>: 0 iff the text is a state-lock-acquire failure. Kept as
# the single source of the trigger string so the wrapper and any caller match it identically.
is_lock_error() { printf '%s' "$1" | grep -q 'Error acquiring the state lock'; }

# read_tflock <gs://bucket/prefix/> <workspace>: echo the raw .tflock JSON, or empty if the
# object is gone (404 → lock already released, the common orphaned-then-reaped case). Best-effort:
# any read error yields empty so the caller treats it as "no lock to inspect". <prefix/> must end
# in a slash (STATE_PREFIX already does); <workspace> is the tofu workspace (default).
read_tflock() {
  local base="$1" workspace="$2"
  gcloud storage cat "${base}${workspace}.tflock" 2>/dev/null || true
}

# tflock_generation <gs://bucket/prefix/> <workspace>: echo the GCS object GENERATION of the
# .tflock, or empty if the object is gone. CRITICAL: for the GCS backend, `tofu force-unlock` takes
# the numeric object generation — NOT the UUID in the .tflock JSON's "ID" field. tofu prints that
# generation as `ID:` in its own "Error acquiring the state lock" box, and force-unlock rejects the
# JSON UUID with "Lock ID should be numerical value". So the release path MUST address the lock by
# this generation. (The JSON "ID" remains the right value for the human-facing lock summary only.)
# Best-effort: any read error / 404 yields empty so the caller treats it as "no lock to release".
tflock_generation() {
  local base="$1" workspace="$2"
  gcloud storage objects describe "${base}${workspace}.tflock" \
    --format='value(generation)' 2>/dev/null || true
}

# tflock_field <tflock-json> <key> [fallback]: extract one field from a .tflock JSON object,
# tolerating malformed/non-JSON input — `read_tflock` is explicitly best-effort and can surface a
# truncated read or a corrupted object, and under this repo's `set -euo pipefail` an unguarded
# `jq -r` failing on non-JSON would otherwise abort the ENTIRE calling script (a plain `x=$(…)`
# assignment on its own line is NOT protected from `set -e` the way `local x=$(…)` looks like it
# should be). Single-sourced so every .tflock field read (describe_lock here, the holder-identity
# read in run.sh's _recover_state_lock) shares one crash-proof extraction instead of repeating an
# unguarded `jq -r '.Foo // "?"'` pipeline at each call site.
tflock_field() {
  local json="$1" key="$2" fallback="${3:-?}"
  printf '%s' "$json" | jq -r --arg k "$key" --arg fb "$fallback" '.[$k] // $fb' 2>/dev/null \
    || printf '%s' "$fallback"
}

# describe_lock <tflock-json>: print the human-facing lock summary (ID/Who/Operation/age) to
# stderr so the operator sees exactly what they are about to break. Age is derived from the
# RFC3339 Created field — `date -j -f` (macOS/BSD) with a `date -d` (GNU/Linux CI) fallback,
# and if neither parses the raw timestamp is shown rather than erroring. No-op on empty input.
describe_lock() {
  local json="$1"
  [[ -n "$json" ]] || return 0
  local id who op created
  id="$(tflock_field "$json" ID)"
  who="$(tflock_field "$json" Who)"
  op="$(tflock_field "$json" Operation)"
  created="$(tflock_field "$json" Created "")"
  local age="unknown age" created_epoch now_epoch
  if [[ -n "$created" ]]; then
    # Strip fractional seconds/zone the BSD parser can't take; both date dialects accept the rest.
    local trimmed="${created%%.*}"; trimmed="${trimmed%Z}"
    created_epoch="$(date -j -f '%Y-%m-%dT%H:%M:%S' "$trimmed" +%s 2>/dev/null \
      || date -d "$created" +%s 2>/dev/null || true)"
    now_epoch="$(date +%s)"
    if [[ -n "$created_epoch" ]]; then
      local secs=$(( now_epoch - created_epoch ))
      (( secs < 0 )) && secs=0
      if   (( secs < 3600 ));  then age="$(( secs / 60 ))m ago"
      elif (( secs < 86400 )); then age="$(( secs / 3600 ))h ago"
      else age="$(( secs / 86400 ))d ago"; fi
    else
      age="$created"
    fi
  fi
  warn "State lock held:"
  warn "  ID:        $id"
  warn "  Who:       $who"
  warn "  Operation: $op"
  warn "  Created:   ${created:-?} (${age})"
}

# _tofu_attempt <invoker> <args…>: run one tofu attempt, streaming output live via `tee` while
# capturing it so the caller can inspect it afterward. Sets the global _TOFU_ATTEMPT_OUTPUT to the
# captured text and returns the real exit code (PIPESTATUS[0], not tee's). Internal to tofu_locked —
# not part of this file's public helper surface.
_tofu_attempt() {
  local invoker="$1"; shift
  local tmp rc
  tmp="$(mktemp)"
  "$invoker" "$@" 2>&1 | tee "$tmp"
  rc="${PIPESTATUS[0]}"
  _TOFU_ATTEMPT_OUTPUT="$(cat "$tmp")"
  rm -f "$tmp"
  return "$rc"
}

# tofu_locked <recover-fn> -- <tofu-invoker> <tofu-args…>: run a lock-contending tofu op
# (plan/apply/destroy) and, if it fails specifically because it could not acquire the state lock,
# call <recover-fn> (the caller's interactive/guided recovery, e.g. run.sh's _recover_state_lock)
# and retry the op EXACTLY ONCE. Any non-lock failure — or a second lock failure after a recovery
# attempt — is re-propagated unchanged so `set -e`/`die` semantics are identical to a bare
# <tofu-invoker> call. Generic over the invoker (not hardcoded to `tofu_`) and the recovery
# callback (not hardcoded to GCP's `_recover_state_lock`) so this stays cloud-agnostic here in
# common.sh alongside the other lock primitives, while run.sh/suspend.sh supply their own.
tofu_locked() {
  local recover_fn="$1"; shift
  [[ "${1:-}" == "--" ]] && shift
  local invoker="$1"; shift
  local rc=0
  _tofu_attempt "$invoker" "$@" || rc=$?
  if (( rc == 0 )); then
    return 0
  fi
  if is_lock_error "$_TOFU_ATTEMPT_OUTPUT"; then
    warn "OpenTofu could not acquire the state lock."
    if "$recover_fn"; then
      log "State lock cleared — retrying: ${invoker} ${*}"
      rc=0
      _tofu_attempt "$invoker" "$@" || rc=$?
      return "$rc"
    fi
    return "$rc"
  fi
  return "$rc"
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

# poll_until [-m <msg_fn>] <max_attempts> <sleep_secs> -- <cmd…>: run <cmd> repeatedly until it
# exits 0 or <max_attempts> is reached, printing a dot per attempt. Returns 0 on success, 1 on
# timeout. The caller prints its own trailing newline + success/failure message so the wording
# stays specific to what was being waited on. Pass a quiet predicate (e.g. a small helper that
# redirects its own noisy command) so only the progress dots reach the terminal.
# -m <msg_fn>: instead of a dot, call `<msg_fn> <attempt> <max_attempts>` after each failed
# attempt — for callers that want a per-attempt diagnostic line (e.g. "not writable yet
# (attempt N/M) — …") instead of the bare dot.
poll_until() {
  local msg_fn=""
  if [[ "${1:-}" == "-m" ]]; then
    msg_fn="$2"; shift 2
  fi
  local attempts="$1" gap="$2"; shift 2
  [[ "${1:-}" == "--" ]] && shift
  local i=0
  until "$@"; do
    i=$((i + 1))
    [[ $i -lt $attempts ]] || return 1
    if [[ -n "$msg_fn" ]]; then
      "$msg_fn" "$i" "$attempts"
    else
      printf '.'
    fi
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

# ds_ar_writable <region> <project> <repo>: 0 iff the Artifact Registry repo EXISTS and the CALLER
# (the WIF-federated deployer SA in CI) actually holds artifactregistry.repositories.uploadArtifacts
# on it — i.e. the push will authorize. Guards the resume/first-apply RACE: run.sh PRE-DISPATCHES
# deploy-gke so build-push overlaps `tofu apply`, but the repo AND the deployer's repo-scoped
# repoAdmin binding are count=environment_active — destroyed on suspend, RECREATED partway through
# that still-running apply. Pushing before the binding lands (or before it propagates to the
# registry data plane) is the exact "denied: ...uploadArtifacts" failure this probe polls away.
# Checks, in order:
#   1. repo describe succeeds       — the repo has been recreated (else 404 → not yet),
#   2. the caller has uploadArtifacts on the repo, asked via the AR `:testIamPermissions` REST API.
#
# WHY NOT match the IAM policy against our own member (the previous approach): under WIF the
# `google-github-actions/auth` action writes an ADC external_account credentials file and never
# registers a gcloud account, so `gcloud config get-value account` returns EMPTY in CI — the old
# `[[ -n "$account" ]] || return 1` guard then failed on EVERY poll and the gate never cleared even
# though the deployer SA genuinely had repoAdmin (the live "attempt 40/40" hang). testIamPermissions
# asks "can THE CALLER do X on this resource" without naming our own identity, so it works identically
# under WIF impersonation, direct SA keys, and local user creds, and resolves inherited / conditional
# / custom-role grants that a member-string match cannot. gcloud has no `test-iam-permissions` verb
# for artifacts, so we POST the REST endpoint with a caller token from `gcloud auth print-access-token`
# (which mints from the same external_account creds the push will use — faithful to the push identity).
# All failures are swallowed to a non-zero return so the CALLER's poll loop retries rather than
# aborting under set -e — same tolerant-probe contract as check-env-active.sh wraps ds_cluster_present.
# A brief settle after this returns true still guards raw data-plane propagation (see build-push.sh).
ds_ar_writable() {
  # repo_id (not `repo`): a lowercase `repo` local would make shellcheck -x, following this source
  # into the CI scripts, flag every uppercase $REPO env use (prune-registry.sh, build-push.sh) as a
  # possible-misspelling SC2153 — those are legit workflow-provided vars, so keep the name distinct.
  local region="$1" project="$2" repo_id="$3" token url
  gcloud artifacts repositories describe "$repo_id" \
    --project "$project" --location "$region" >/dev/null 2>&1 || return 1
  token="$(gcloud auth print-access-token 2>/dev/null)" || return 1
  [[ -n "$token" ]] || return 1
  url="https://artifactregistry.googleapis.com/v1/projects/${project}/locations/${region}/repositories/${repo_id}:testIamPermissions"
  # A granted permission is echoed back in the response's `permissions` array; a caller WITHOUT it
  # gets a 200 with the field omitted (empty). grep the returned permission name to decide — a 4xx
  # (repo/propagation not ready) also fails the grep, so the caller retries.
  curl -sf --max-time 10 -X POST \
    -H "Authorization: Bearer ${token}" -H 'Content-Type: application/json' \
    -d '{"permissions":["artifactregistry.repositories.uploadArtifacts"]}' \
    "$url" 2>/dev/null | grep -q 'artifactregistry.repositories.uploadArtifacts'
}

# ds_ar_wait <region> <project> <repo>: BLOCK until ds_ar_writable is true, bounded by
# AR_WAIT_ATTEMPTS (default 40) × AR_WAIT_GAP secs (default 15) ≈ 10 min. Returns 0 the moment the
# deployer SA can push, 1 on timeout. Single source of the bounded AR-writable wait — the poll
# budget, the per-attempt "not writable yet (attempt N/M)" progress line, and the ds_ar_writable
# probe — shared by BOTH pushers of it: build-push.sh (CI's pre-push gate, which maps a 1 return to a
# hard ::error:: exit) and run.sh's _wait_ar_push_ready (the pre-dispatch gate, which maps 1 to a
# soft warn). Splitting the WAIT (here) from the OUTCOME (each caller) keeps one reason-to-change per
# unit: tune the budget/message once here; each caller still decides fail-hard vs. continue. Emits its
# progress lines with `echo` (not warn/log) so it stays runtime-agnostic — GitHub Actions surfaces
# them as plain step output, run.sh as ordinary stdout — while the callers add their own tagged
# framing around it. The 10-min envelope covers the IAM apply + registry-data-plane propagation tail
# without outliving CI's 15m job cap or a resume.
ds_ar_wait() {
  local region="$1" project="$2" repo_id="$3"
  local attempts="${AR_WAIT_ATTEMPTS:-40}" gap="${AR_WAIT_GAP:-15}"
  # shellcheck disable=SC2317,SC2329  # invoked indirectly by poll_until via the -m message hook
  _ds_ar_wait_msg() { echo "Artifact Registry '$repo_id' not writable yet (attempt $1/$2) — repo/IAM binding still propagating to the registry; waiting ${gap}s…"; }
  poll_until -m _ds_ar_wait_msg "$attempts" "$gap" -- ds_ar_writable "$region" "$project" "$repo_id"
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
