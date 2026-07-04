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

# The container images this project builds and deploys — declared once so adding or renaming
# an image is a single edit shared by every script that sources this library (the builder in
# build-push.sh). The deep-suspend path no longer needs this list: it deletes the whole
# Artifact Registry repo rather than looping individual images.
# shellcheck disable=SC2034  # consumed by scripts that source this library, not here
DEVSTASH_IMAGES=(web migrate)

# ds_image_base <region> <project> <repo>: the Artifact Registry repo path that every
# devstash image hangs off (e.g. us-central1-docker.pkg.dev/<project>/devstash). Kept here
# so build-push.sh derives it identically to the rest of the tooling.
ds_image_base() {
  printf '%s-docker.pkg.dev/%s/%s' "$1" "$2" "$3"
}

# ds_newest_enabled_secret_version <secret> <project>: echo the resource name of the newest
# state:ENABLED version of <secret>, or nothing (non-fatal) if the secret is absent / has no
# enabled version. Resolve the newest ENABLED version rather than `access latest`, because
# `latest` points at the highest-numbered version regardless of state — one DISABLED/DESTROYED
# top version (e.g. from an interrupted rotation) makes `access latest` fail with
# FAILED_PRECONDITION and breaks reads. The auto-suspend Cloud Build path (auto-suspend-prepare.sh)
# mirrors this same hardening by necessity (it cannot source this file — see the header note).
ds_newest_enabled_secret_version() {
  gcloud secrets versions list "$1" --project="$2" \
    --filter=state:ENABLED --sort-by=~createTime --limit=1 --format='value(name)' 2>/dev/null || true
}

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
