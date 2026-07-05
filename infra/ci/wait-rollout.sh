#!/usr/bin/env bash
# Gate: new web pods must become healthy within 300s.
#
# DO NOT auto-rollback here. By this point the migration job has already run successfully
# (it is the gate above this step), so the DB schema is advanced past what the previous
# image understood. Rolling the Deployment back to the old image would put old code against
# a newer schema — likely causing crashes or data corruption. If the rollout fails: fix
# forward with a new commit that fixes the pod startup issue. The old pods are still running
# (maxUnavailable: 0), so traffic is uninterrupted while you fix and re-deploy.
set -euo pipefail

# shellcheck source=infra/lib/common.sh
source "$(dirname "${BASH_SOURCE[0]}")/../lib/common.sh"

NS="$DEVSTASH_NS"
if kubectl -n "$NS" rollout status deployment/devstash-web --timeout=300s; then
  exit 0
fi

echo "::error::Rollout failed — new pods did not become healthy"
echo "::error::DO NOT roll back the Deployment — migrations have already run against the new schema."
echo "::error::Fix forward: push a commit that resolves the pod startup failure."
echo "--- Recent pod events ---"
kubectl -n "$NS" describe deployment/devstash-web | tail -20 || true
echo "--- Logs from failing pods ---"
# WHY loop: `kubectl logs --previous` requires a specific pod name and is rejected when
# combined with a label selector (-l). Collecting pod names first and looping is the only
# correct way to capture previous container logs for multiple pods via a selector.
kubectl -n "$NS" get pods -l app.kubernetes.io/name=devstash \
  -o name 2>/dev/null \
  | xargs -I{} kubectl -n "$NS" logs {} --previous --tail=100 2>/dev/null \
  || true
exit 1
