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
RESP="$(curl -s -G "https://monitoring.googleapis.com/v3/projects/$_PROJECT_ID/timeSeries" \
  -H "Authorization: Bearer $(gcloud auth print-access-token)" \
  --data-urlencode 'filter=metric.type="loadbalancing.googleapis.com/https/request_count"' \
  --data-urlencode "interval.startTime=$START" \
  --data-urlencode "interval.endTime=$END" \
  --data-urlencode "aggregation.alignmentPeriod=${_IDLE_WINDOW}s" \
  --data-urlencode 'aggregation.perSeriesAligner=ALIGN_SUM' \
  --data-urlencode 'aggregation.crossSeriesReducer=REDUCE_SUM')"
COUNT="$(printf '%s' "$RESP" | python3 -c 'import json,sys
d = json.load(sys.stdin)
print(int(sum(float(p["value"].get("int64Value", p["value"].get("doubleValue", 0))) for s in d.get("timeSeries", []) for p in s.get("points", []))))')"
echo "LB request_count over idle window: $COUNT"
if [ "$COUNT" -eq 0 ]; then
  echo "idle — will suspend"
  touch /workspace/SUSPEND
else
  echo "traffic present ($COUNT requests) — skipping suspend"
fi
