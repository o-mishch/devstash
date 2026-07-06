#!/bin/sh
# Cloud Build step 1 — GUARD (see auto-suspend.tf). $_VAR values are Cloud Build substitutions
# mapped onto the step env — the `script` field doesn't expand them in content — so plain POSIX shell.
#
# Fired by TWO sources on one Pub/Sub topic (see auto-suspend.tf): the idle Monitoring alert
# AND a Cloud Scheduler cron. This guard decides whether to actually suspend, writing a
# /workspace/SUSPEND sentinel the later steps require; any other case is a clean no-op. It
# suspends when EITHER:
#   (a) HARD UPTIME CAP — the cluster is older than $_MAX_UPTIME. Unconditional, ignores
#       traffic. This is the scanner-proof backstop: a public LB never sees true-zero traffic
#       (internet scanners keep request_count > 0), so the zero-traffic path (b) alone can
#       fail to fire forever; the cap guarantees teardown within the scheduler cadence of
#       $_MAX_UPTIME. Because resume is deliberate/manual, capping uptime after a resume is
#       exactly right for an on-demand showcase.
#   (b) GENUINELY IDLE — the cluster is older than the fresh-resume grace ($_IDLE_WINDOW) AND
#       served zero LB requests across that window. Fast path for a real idle gap.
#
# DEPLOY / PROVISIONING IN-FLIGHT DEFERS ONLY PATH (b), NEVER PATH (a). A deploy-gke.yml run
# does real work against the live cluster (Helm installs, kubectl rollout) that generates ZERO
# ingress LB traffic, so it is indistinguishable from "idle" to the traffic check below — this
# is exactly what let auto-suspend tear the cluster down mid-deploy (state-lock check above
# doesn't help; `run.sh deploy` only dispatches CI, it never touches Terraform or the lock). A
# plain local `run.sh apply` (fresh bring-up, no CI dispatch to poll) is the same blind spot —
# a GCS marker (see below) covers that case. Both checks sit between the uptime cap and the
# idle-traffic check so they defer the fast idle path but deliberately do NOT block the hard
# uptime cap — a wedged/hung run must never pin the environment up forever; the scanner-proof
# backstop stays unconditional.
set -eu
# --limit=1 (not `| head -n1`): POSIX sh has no pipefail, so a piped `head` would mask a
# gcloud/API error as an empty CREATED and misread a transient failure as "already suspended".
# Letting gcloud itself cap the output keeps `set -e` able to abort on a real gcloud failure.
CREATED="$(gcloud container clusters list --region="$_REGION" --project="$_PROJECT_ID" --format='value(createTime)' --limit=1)"
if [ -z "$CREATED" ]; then
  echo "no cluster found (already suspended) — nothing to do"
  exit 0
fi
# A human `run.sh apply/suspend/resume` in progress holds the OpenTofu state lock. The
# auto-suspend build and that human command share one lock, so proceeding here would collide
# mid-apply (the loser dies with "Error acquiring the state lock", and breaking the collision
# risks an orphaned lock + a half-torn-down env). run.sh serialises the OTHER direction by
# waiting for this build; this closes the loop — if the lock is already held, the human is
# mid-flight, so no-op and let the next scheduled tick re-evaluate. The lock object lives at
# the fixed backend prefix (gke/dev, see backend.tf) in the state bucket.
if gcloud storage objects describe "gs://$_STATE_BUCKET/gke/dev/default.tflock" >/dev/null 2>&1; then
  echo "state lock held (a run.sh apply/suspend/resume is in progress) — skipping to avoid a mid-apply collision"
  exit 0
fi
# DEDUP CONCURRENT AUTO-SUSPEND BUILDS (layer 1). The idle Monitoring alert AND the uptime-cap cron
# publish to ONE Pub/Sub topic (see auto-suspend.tf), so two builds can start seconds apart. The
# human-lock check above can't catch that: the state lock isn't ACQUIRED until the far-later suspend
# step (step 4), so BOTH builds' guards see a free lock, both proceed, and the second dies with
# "Error acquiring the state lock" once the first grabs it for a multi-minute GKE+SQL destroy (the
# exact failure that motivated this). Fix at the source: if another auto-suspend build for this env
# started BEFORE this one, defer to it (clean no-op) so only the single earliest build proceeds.
# Needs the repo (for the shared helper) — clone it now, idempotently (the same guarded clone the
# deploy-in-flight check below uses; prepare reuses this checkout).
[ -d /workspace/repo ] || git clone --depth 1 --branch "$_REPO_BRANCH" "https://github.com/$_REPO_SLUG.git" /workspace/repo
# shellcheck source=infra/lib/posix/lock-contention.sh
. /workspace/repo/infra/lib/posix/lock-contention.sh
if ds_older_autosuspend_build_running "$_REGION" "$_PROJECT_ID" "$_TRIGGER_NAME" "$_BUILD_ID"; then
  echo "an earlier auto-suspend build is already in flight — deferring to it (no-op) so the two don't race the state lock"
  exit 0
fi
AGE=$(( $(date -u +%s) - $(date -u -d "$CREATED" +%s) ))
# (a) Hard uptime cap — suspend regardless of traffic. Checked first: _MAX_UPTIME >=
# _IDLE_WINDOW (enforced by variable validation), so this never conflicts with the grace below.
if [ "$AGE" -ge "$_MAX_UPTIME" ]; then
  echo "cluster age $AGE s >= max uptime $_MAX_UPTIME s — hard uptime cap reached, will suspend (traffic ignored)"
  touch /workspace/SUSPEND
  exit 0
fi
if [ "$AGE" -lt "$_IDLE_WINDOW" ]; then
  echo "cluster age $AGE s < idle window $_IDLE_WINDOW s — too fresh, skipping to avoid flapping"
  exit 0
fi
# A human `run.sh apply` (fresh bring-up, no CI dispatch) does real work against the cluster
# — ESO install, initial deploy, DNS wiring — that generates ZERO ingress LB traffic, same as a
# deploy-gke.yml run below, but there is no CI run to poll for a plain local apply. run.sh writes
# this marker right after clearing the state-lock wait (see mark_provisioning in run.sh) and
# removes it on every exit path, so a stale marker can only ever outlive a crashed/killed run.sh
# process — self-healing on its own next apply, and bounded here by the same idle-window grace
# as everything else (a marker older than the window is treated as stale, not honored forever).
# DEFERS ONLY PATH (b), NEVER PATH (a) above — same posture as the deploy-in-flight check below:
# a wedged/killed run.sh must never pin the environment up forever past the scanner-proof cap.
PROVISIONING_AGE="$(gcloud storage objects describe "gs://$_STATE_BUCKET/gke/dev/.provisioning" --format='value(timeCreated)' 2>/dev/null || true)"
if [ -n "$PROVISIONING_AGE" ]; then
  MARKER_SECS=$(( $(date -u +%s) - $(date -u -d "$PROVISIONING_AGE" +%s) ))
  if [ "$MARKER_SECS" -lt "$_IDLE_WINDOW" ]; then
    echo "provisioning marker present (a run.sh apply started ${MARKER_SECS}s ago) — skipping to avoid tearing down a fresh bring-up"
    exit 0
  fi
  echo "provisioning marker present but stale (${MARKER_SECS}s old, >= idle window ${_IDLE_WINDOW}s) — likely an interrupted run.sh; not honoring it"
fi
# A deploy-gke.yml run in progress or queued means CI is actively using the cluster right now —
# skip the idle suspend and let the next scheduled tick re-evaluate. Public repo, unauthenticated
# read of the Actions API (no token needed, no new secret to grant this SA). Standalone .py
# helper (not inline) for the same reason as auto-suspend-idle-count.py: independently
# lintable/testable, and cloud-sdk:slim's no-runtime-installs posture means no curl dependency.
[ -d /workspace/repo ] || git clone --depth 1 --branch "$_REPO_BRANCH" "https://github.com/$_REPO_SLUG.git" /workspace/repo
if REPO_SLUG="$_REPO_SLUG" python3 /workspace/repo/infra/terraform/envs/dev/scripts/auto-suspend-deploy-check.py; then
  echo "a deploy-gke.yml run is in progress/queued — skipping idle suspend to avoid tearing down the cluster mid-deploy"
  exit 0
fi
START="$(date -u -d "-$_IDLE_WINDOW seconds" +%Y-%m-%dT%H:%M:%SZ)"
END="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
# The idle traffic check needs the standalone idle-count helper from the repo — already cloned
# above by the deploy in-flight check (reached ONLY on the genuinely-idle path: the no-cluster /
# too-fresh / uptime-cap paths above already exited), so a suspended or just-resumed env never
# clones. prepare reuses this same checkout. Languages stay segregated: the JSON summation lives
# in the .py helper, invoked with python3 — never inlined into this shell.
# All query params + the OAuth token go through the ENVIRONMENT so the token never appears in argv.
COUNT="$(
  MON_PROJECT="$_PROJECT_ID" MON_START="$START" MON_END="$END" MON_WINDOW="$_IDLE_WINDOW" \
  MON_TOKEN="$(gcloud auth print-access-token)" \
  python3 /workspace/repo/infra/terraform/envs/dev/scripts/auto-suspend-idle-count.py
)"
echo "LB request_count over idle window: $COUNT"
if [ "$COUNT" -eq 0 ]; then
  echo "idle — will suspend"
  touch /workspace/SUSPEND
else
  echo "traffic present ($COUNT requests) — skipping suspend"
fi
