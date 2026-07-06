# shellcheck shell=sh
# PORTABLE POSIX-sh helper for reading Secret Manager secrets by their newest ENABLED version —
# the ONE source of truth for the "avoid `access latest`" hardening, shared across both dialects:
#
#   • bash  — infra/lib/common.sh sources this file, so run.sh (app-config read), dns.sh (ops-config
#             read), and wait-secrets-sync.sh (CI) all get ds_newest_enabled_secret_version +
#             ds_access_secret_blob transparently — the bash callers lose nothing.
#   • /bin/sh — infra/terraform/envs/dev/scripts/auto-suspend-prepare.sh (Cloud Build step 2,
#               unattended auto-suspend) `.`-sources this file AFTER it git-clones the repo into
#               /workspace/repo, then wraps ds_newest_enabled_secret_version with its own FATAL
#               fetch (prepare MUST have the secret, unlike the tolerant bash reads).
#
# WHY newest-ENABLED, not `access latest`: `latest` points at the highest-numbered version REGARDLESS
# of state, so a single DISABLED/DESTROYED top version (e.g. left by an interrupted rotation) makes
# `access latest` fail with FAILED_PRECONDITION and blocks the read (unattended: the whole suspend).
# Resolving the newest state:ENABLED version sidesteps that. Single-sourcing it here is what stops the
# bash and the /bin/sh copies from drifting on this hardening (the sh copy used to hand-mirror it).
#
# CRITICAL — EVERYTHING IS A PARAMETER (see infra/lib/posix/dump.sh + reap-negs.sh headers): a git-
# cloned, sourced file is NOT processed by Cloud Build $_VAR substitution, and callers use different
# global names ($PROJECT_ID vs $_PROJECT_ID), so this file references only its positional args. No
# `local` / `[[ ]]` / arrays — plain POSIX so `#!/bin/sh` (cloud-sdk:slim) can source it directly.
#
# Source-guard: sourcing twice is a harmless no-op.
[ -n "${_DEVSTASH_POSIX_SECRETS_SH:-}" ] && return 0
_DEVSTASH_POSIX_SECRETS_SH=1

# ds_newest_enabled_secret_version <secret> <project>: echo the resource name of the newest
# state:ENABLED version of <secret>, or nothing (non-fatal) if the secret is absent / has no
# enabled version. See the "avoid `access latest`" rationale above. Callers layer their own
# fatal-vs-tolerant policy on the empty result.
ds_newest_enabled_secret_version() {
  gcloud secrets versions list "$1" --project="$2" \
    --filter=state:ENABLED --sort-by=~createTime --limit=1 --format='value(name)' 2>/dev/null || true
}

# ds_access_secret_blob <secret> <project>: echo the payload of <secret>'s newest ENABLED version,
# or nothing (empty output, non-fatal) if the secret is absent / has no enabled version. Folds the
# resolve-newest-enabled + access + tolerate-missing idiom that the app-config read (run.sh) and the
# ops-config read (dns.sh) both perform, on top of ds_newest_enabled_secret_version so the hardening
# stays single-sourced. TOLERANT by design — a fatal caller (prepare.sh) resolves the version itself
# and dies on empty instead of calling this.
ds_access_secret_blob() {
  _dasb_ver="$(ds_newest_enabled_secret_version "$1" "$2")"
  [ -n "$_dasb_ver" ] || return 0
  gcloud secrets versions access "$_dasb_ver" --secret="$1" --project="$2" 2>/dev/null || true
}
