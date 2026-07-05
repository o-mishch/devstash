#!/usr/bin/env bash
# Detect whether the dev environment is deep-suspended (its GKE cluster has been destroyed)
# so the DEPLOY job can SKIP cleanly instead of dying at "Get GKE credentials" against a
# cluster that no longer exists.
#
# Writes `suspended=true|false` to $GITHUB_OUTPUT. A suspended environment is an EXPECTED
# state (someone merged to main while the showcase is parked at ~$0), so the caller job
# surfaces it as a warning and self-skips — it is NOT a build failure. A single gcloud/auth
# error is tolerated per-attempt (see the `|| true` below) so a transient blip doesn't
# permanently misreport suspended — but a PERSISTENT failure exhausts the poll window just like
# a genuinely absent cluster and reports suspended, the same safe skip either way.
#
# WHY POLL (not a one-shot check): run.sh resume/up PRE-DISPATCH this workflow so the
# cluster-independent build-push job overlaps `apply` (Cloud SQL ~10 min + control plane
# ~5-7 min). This preflight runs after build-push (see deploy-gke.yml `needs`), but the
# cluster may STILL be mid-creation. A one-shot check would then wrongly report suspended and
# permanently skip the deploy. So poll for the cluster for a bounded window: a resume/up in
# flight resolves to active once the control plane registers; a genuinely parked env exhausts
# the window and resolves to suspended, skipping cleanly. The window covers the residual gap
# between build-push finishing and the control plane becoming listable — NOT the full apply,
# which build-push's own runtime already absorbed.
#
# Required env:
#   CLUSTER, REGION   — from the workflow-level env block
#   GCP_PROJECT_ID    — from secrets
# Optional env:
#   CLUSTER_WAIT_ATTEMPTS (default 40) × CLUSTER_WAIT_GAP secs (default 15) = ~10 min max wait.
# shellcheck source=infra/lib/common.sh
source "$(dirname "${BASH_SOURCE[0]}")/../lib/common.sh"

set -euo pipefail

# Fail fast if a required env var is missing; also silences shellcheck SC2153 for
# these workflow-provided uppercase vars (their lowercase lookalikes appear only in comments).
: "${CLUSTER:?CLUSTER is required}" "${REGION:?REGION is required}"

attempts="${CLUSTER_WAIT_ATTEMPTS:-40}"
gap="${CLUSTER_WAIT_GAP:-15}"

# _cluster_present_or_retry: wraps ds_cluster_present (common.sh) with `|| true` so a transient
# API error is treated as "not yet" for this attempt (the loop retries) instead of aborting the
# whole script under `set -e` — a persistent failure just exhausts the window and reports
# suspended, which is the safe skip anyway (the deploy job would fail against a missing cluster).
_cluster_present_or_retry() { ds_cluster_present "$CLUSTER" "$GCP_PROJECT_ID" "$REGION" 2>/dev/null || true; }

i=0
while [ "$i" -lt "$attempts" ]; do
  if _cluster_present_or_retry; then
    echo "Environment active — GKE cluster '$CLUSTER' is present. Proceeding with deploy."
    echo "suspended=false" >> "$GITHUB_OUTPUT"
    exit 0
  fi
  i=$((i + 1))
  [ "$i" -lt "$attempts" ] || break
  echo "GKE cluster '$CLUSTER' not listable yet (attempt $i/$attempts) — a resume/up may be provisioning it; waiting ${gap}s…"
  sleep "$gap"
done

echo "::warning::Environment is suspended — GKE cluster '$CLUSTER' did not appear within ~$((attempts * gap))s. Skipping deploy: nothing is deployed and nothing fails. Bring it back with: bash infra/run/gcp/run.sh resume"
echo "suspended=true" >> "$GITHUB_OUTPUT"
