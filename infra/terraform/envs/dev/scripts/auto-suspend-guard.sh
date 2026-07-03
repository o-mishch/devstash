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
set -eu
CREATED="$(gcloud container clusters list --region="$_REGION" --project="$_PROJECT_ID" --format='value(createTime)' | head -n1)"
if [ -z "$CREATED" ]; then
  echo "no cluster found (already suspended) — nothing to do"
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
START="$(date -u -d "-$_IDLE_WINDOW seconds" +%Y-%m-%dT%H:%M:%SZ)"
END="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
# The idle traffic check needs the standalone idle-count helper from the repo. cloud-sdk:slim
# ships git, so shallow-clone the repo here — reached ONLY on the genuinely-idle path (the
# no-cluster / too-fresh / uptime-cap paths above already exited), so a suspended or just-resumed
# env never clones. prepare reuses this same checkout. Languages stay segregated: the JSON
# summation lives in the .py helper, invoked with python3 — never inlined into this shell.
[ -d /workspace/repo ] || git clone --depth 1 --branch "$_REPO_BRANCH" "https://github.com/$_REPO_SLUG.git" /workspace/repo
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
