# shellcheck shell=bash
# Shared bash helpers for the DevStash deploy tooling. SOURCED (never executed) so the
# Artifact Registry image coordinates live in exactly one place, consumed identically by
# infra/gcp-run/run.sh (laptop bootstrap) and infra/ci/*.sh (GitHub Actions steps).
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
