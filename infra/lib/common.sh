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

# The container images this project builds, deploys, and purges — declared once so adding
# or renaming an image is a single edit shared by the builder and the laptop purge path
# (run.sh purge_images). MIRRORED by local.devstash_images in
# infra/terraform/envs/dev/auto-suspend.tf, which feeds the Cloud Build purge step's $_IMAGES
# — that /bin/sh step can't source this bash lib, so keep the two lists in sync.
# shellcheck disable=SC2034  # consumed by scripts that source this library, not here
DEVSTASH_IMAGES=(web migrate)

# ds_image_base <region> <project> <repo>: the Artifact Registry repo path that every
# devstash image hangs off (e.g. us-central1-docker.pkg.dev/<project>/devstash). Kept here
# so build-push.sh and run.sh purge_images() derive it identically.
ds_image_base() {
  printf '%s-docker.pkg.dev/%s/%s' "$1" "$2" "$3"
}
