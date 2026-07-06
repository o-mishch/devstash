#!/usr/bin/env bash
# Gate: the PUBLIC URL must actually serve before the deploy is called done.
#
# WHY this exists on top of wait-rollout.sh: `kubectl rollout status` returns the moment the
# *pod's* readiness probe passes — but that is NOT when https://$APP_DOMAIN starts serving. GKE
# Gateway routes external traffic through a SEPARATE path the rollout gate knows nothing about:
# the NEG controller must register the pod IP as a network endpoint, the Gateway's Google Cloud
# BackendService must attach that NEG, and the L7 load balancer's OWN health check (distinct from
# the Kubernetes probe) must mark the endpoint HEALTHY. Until that finishes the LB has zero healthy
# backends and answers 502. On a from-scratch resume (Gateway → BackendService → NEG all created
# fresh, plus an Autopilot node scale-up) that gap is minutes — so for minutes AFTER the workflow
# went green the site returned 502. This step closes that gap: the deploy job is only "success"
# once the URL genuinely serves, so a green run means a servable site.
#
# The probe is ds_health_ok against /api/health?deep=1 — the SAME deep-health predicate run.sh's
# `smoke` uses (via _app_healthy in lib/gke.sh). It passes only when the JSON body reports
# {"status":"ok"}, which for ?deep=1 means the DB is reachable too — proving the pod serves a real
# request end-to-end through the public LB, not just that some 200 came back.
#
# WARN-AND-FINISH parity with the surrounding steps: this runs only when eso-sync synced=true (a
# real rollout happened), mirroring wait-secrets-sync.sh's gating. If APP_DOMAIN is unset (never
# expected on a real deploy) we skip rather than fail — there is nothing meaningful to poll.
#
# Required env:
#   APP_DOMAIN — the public host the Gateway serves (GitHub Actions repo var)
set -euo pipefail

# shellcheck source=infra/lib/common.sh
source "$(dirname "${BASH_SOURCE[0]}")/../lib/common.sh"

if [ -z "${APP_DOMAIN:-}" ]; then
  echo "::warning::APP_DOMAIN is unset — skipping the public-endpoint gate. The rollout is healthy; only the end-to-end URL check was skipped."
  exit 0
fi

URL="https://${APP_DOMAIN}/api/health?deep=1"

echo "Waiting for the public endpoint to serve: $URL"
# 60 × 10s = 10 min ceiling — same magnitude as wait-rollout.sh, sized for a from-scratch resume
# where the Gateway/BackendService/NEG stack and an Autopilot node all come up cold. ds_health_ok
# (common.sh) is the quiet predicate — its own curl output is discarded; poll_until prints dots.
if poll_until 60 10 -- ds_health_ok "$URL"; then
  printf '\n'
  ok "public endpoint is serving — ${URL} reports status:ok"
  exit 0
fi

printf '\n'
echo "::error::Public endpoint $URL did not report healthy within 10m." >&2
echo "::error::Pods are healthy (wait-rollout passed) but the load balancer never routed to a healthy backend." >&2
echo "--- Gateway / HTTPRoute status ---" >&2
kubectl -n "$DEVSTASH_NS" get gateway,httproute -o wide >&2 || true
echo "--- Recent namespace events ---" >&2
kubectl -n "$DEVSTASH_NS" get events --sort-by=.lastTimestamp >&2 | tail -30 || true
exit 1
