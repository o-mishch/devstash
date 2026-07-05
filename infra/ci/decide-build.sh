#!/usr/bin/env bash
# Gate the image build: decide whether deploy-gke should build+push at all, or skip because the
# environment is parked at ~$0. Writes `build=true|false` to $GITHUB_OUTPUT for the `gate` job.
#
# WHY this exists: build-push runs BEFORE the cluster is created (it overlaps `apply` on a
# run.sh resume/up), so a live cluster check alone cannot distinguish the two cluster-absent
# cases — "resume in flight, build wanted" vs "parked env, skip". Combine two cheap signals:
#   • DISPATCH_REASON == 'provision'  — run.sh set this because it IS provisioning (build wanted).
#   • the GKE cluster already exists  — env is active (a normal push to main, build wanted).
# Neither holds → parked env → build=false, so build-push + preflight + deploy all skip cleanly
# and no images are rebuilt/repushed only to be purged by the next suspend.
#
# A genuine gcloud/auth error is NOT swallowed: the cluster list runs under `set -e`, so an API
# failure fails this step loudly rather than being misread as "no cluster → skip". The provision
# short-circuit is checked FIRST so a resume/up never even needs the cluster probe.
#
# Required env:
#   CLUSTER, REGION   — from the workflow-level env block
#   GCP_PROJECT_ID    — from secrets
#   DISPATCH_REASON   — github.event.inputs.reason ('' on a push event)
set -euo pipefail

# shellcheck source=infra/lib/common.sh
source "$(dirname "${BASH_SOURCE[0]}")/../lib/common.sh"

# Fail fast if a required env var is missing; also silences shellcheck SC2153 for
# these workflow-provided uppercase vars (their lowercase lookalikes appear only in comments).
: "${CLUSTER:?CLUSTER is required}" "${REGION:?REGION is required}"

if [ "${DISPATCH_REASON:-}" = "provision" ]; then
  echo "Dispatch reason is 'provision' — run.sh is bringing the environment up/back. Building (cluster will exist shortly)."
  echo "build=true" >> "$GITHUB_OUTPUT"
  exit 0
fi

# No `|| true` here — ds_cluster_present (common.sh) does not swallow a `gcloud list` failure,
# so a genuine API error propagates under `set -e` and fails this step loudly rather than being
# misread as "no cluster → skip".
if ds_cluster_present "$CLUSTER" "$GCP_PROJECT_ID" "$REGION"; then
  echo "GKE cluster '$CLUSTER' is present — environment active. Building."
  echo "build=true" >> "$GITHUB_OUTPUT"
else
  echo "::warning::No GKE cluster '$CLUSTER' and this is not a run.sh provision — environment is parked at ~\$0. Skipping build + deploy so no images are wastefully rebuilt/repushed. Bring it back with: bash infra/run/gcp/run.sh resume"
  echo "build=false" >> "$GITHUB_OUTPUT"
fi
