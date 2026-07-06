#!/usr/bin/env bash
# Preflight gate: block the DEPLOY job until devstash-app-config has an accessible ENABLED
# version, so ESO sync (and the whole migrate→rollout tail) never runs in the window where the
# secret momentarily has ZERO enabled versions.
#
# WHY THIS GATE EXISTS — the disable-old-then-add-new race. The app-config version is a
# write-only Terraform resource (secret_data_wo + a hash-derived secret_data_wo_version; see
# infra/terraform/modules/iam/main.tf). Its comment claims the value updates "IN PLACE", but the
# provider actually performs a version bump as TWO separate Secret Manager operations —
# DisableSecretVersion on the old version, then AddSecretVersion for the new one. Between those
# two calls the secret has NO enabled version. A deploy that lands in that gap reads an empty blob,
# ESO can't sync, and wait-secrets-sync.sh (before it was hardened) reported the empty read as a
# benign parked env and finished GREEN — masking a full outage. This actually happened: a
# Terraform apply disabled version N at T and created version N+1 ~16 min later; a merge-triggered
# deploy ran in that gap and silently "succeeded" with the app broken.
#
# WHY POLL (not a one-shot check): the gap is transient — an apply/resume in flight closes it once
# AddSecretVersion lands. A one-shot check would flake whenever a deploy overlaps an apply. So poll
# for a bounded window: an apply mid-flight resolves to "enabled version present" the moment the
# new version is added; a genuinely broken secret (never created, IAM/Workload-Identity broken, or
# a version disabled with no replacement) exhausts the window and FAILS the build loudly. This
# mirrors check-env-active.sh's bounded-poll philosophy, but its failure mode is the OPPOSITE: a
# missing cluster is an expected parked state (skip), whereas a missing enabled version is a real
# fault (fail) — the "always one enabled version" invariant means an empty read is never benign.
#
# The presence check reads only the version's RESOURCE NAME (ds_newest_enabled_secret_version),
# never the payload — no secret material reaches the CI log.
#
# Required env:
#   GCP_PROJECT_ID — from secrets (the project holding devstash-app-config)
# Optional env:
#   SECRET_VERSION_WAIT_ATTEMPTS (default 20) × SECRET_VERSION_WAIT_GAP secs (default 6) = ~2 min.
set -euo pipefail

# shellcheck source=infra/lib/common.sh
source "$(dirname "${BASH_SOURCE[0]}")/../lib/common.sh"

: "${GCP_PROJECT_ID:?GCP_PROJECT_ID is required}"

SM_SECRET=devstash-app-config
attempts="${SECRET_VERSION_WAIT_ATTEMPTS:-20}"
gap="${SECRET_VERSION_WAIT_GAP:-6}"

# _enabled_version_present: 0 iff devstash-app-config has an accessible newest-ENABLED version.
# ds_newest_enabled_secret_version echoes the resource name (or nothing) and tolerates a transient
# gcloud/auth error by echoing nothing — so a blip just retries, exactly like the gap closing.
_enabled_version_present() {
  [[ -n "$(ds_newest_enabled_secret_version "$SM_SECRET" "$GCP_PROJECT_ID")" ]]
}

# poll_until message hook — kept at module scope so the gap arrives as a forwarded msg_arg ($3)
# rather than a closed-over local (see the if/else note below for the SC2317 reachability angle).
# Mirrors ds_ar_wait's _ds_ar_wait_msg / check-env-active.sh's _cluster_wait_msg.
_secret_version_wait_msg() { echo "'$SM_SECRET' has no ENABLED version yet (attempt $1/$2) — a Terraform apply/resume may be mid-version-bump (disable-old→add-new gap); waiting ${3}s…"; }

log "Waiting for an ENABLED version of '$SM_SECRET' (deploy gate — closes the version-bump gap)"

# if/else (not an exit-0 then-branch + terminating die tail): with poll_until as the last
# statement before a guaranteed-exit tail, shellcheck's reachability pass can't trace the -m/--
# indirection into the sourced poll_until and wrongly flags the two callbacks below as unreachable
# (SC2317). Branching visibly keeps poll_until off the exit path and clears it — no disable needed.
if poll_until -m _secret_version_wait_msg :: "$gap" :: "$attempts" "$gap" -- _enabled_version_present; then
  ok "'$SM_SECRET' has an ENABLED version — safe to proceed to ESO sync."
else
  die "'$SM_SECRET' still has no accessible ENABLED version after $((attempts * gap))s — not a transient version-bump gap. The secret was never created, Workload Identity/IAM access is broken, or a version was disabled without an enabled replacement. Recover with: bash infra/run/gcp/run.sh resume (or a Terraform apply on the active env), then re-run this deploy."
fi
