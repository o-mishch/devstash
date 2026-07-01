#!/usr/bin/env bash
# Run DB migrations + seed item types as a gated Job BEFORE the web Deployment rolls to the
# new image (a real migrate→rollout gate, not the old :latest race). Database (Cloud SQL) +
# Redis (Memorystore) are Terraform-managed; the migrate Job is applied here separately.
#
# migrate-job.yaml is applied directly (not via `kustomize`), but the file has
# `namespace: devstash` hard-coded so the namespace is always correct. It is intentionally
# NOT in kustomization.yaml `resources` because kustomize would fail on the immutable Job on
# re-apply. The yq image injection here mirrors what kustomize's `images` transformer does
# for the web Deployment.
#
# Required env:
#   MIGRATE_IMAGE  — from build-push.sh via $GITHUB_ENV
set -euo pipefail

NS=devstash   # target namespace (base kustomize; matches settings.yaml)
cd infra/k8s/overlays/gcp

# Capture logs from any prior failed job BEFORE deleting it. If this step failed in a
# previous run and the engineer re-runs the job, the delete below destroys the pod and its
# logs. Capture first so post-mortem diagnostics survive the re-run. `|| true` is
# intentional — no prior job is normal.
kubectl -n "$NS" logs job/devstash-migrate --tail=100 \
  > /tmp/migrate-prev-logs.txt 2>/dev/null || true
if [ -s /tmp/migrate-prev-logs.txt ]; then
  echo "--- Logs from previous migrate job (captured before delete) ---"
  cat /tmp/migrate-prev-logs.txt
fi

# A Job's pod template is immutable — delete any prior run before re-applying with this
# build's migrate image. Write the patched manifest to a temp file to avoid mutating the
# tracked source.
kubectl -n "$NS" delete job devstash-migrate --ignore-not-found
MIGRATE_IMAGE="${MIGRATE_IMAGE}" yq '.spec.template.spec.containers[0].image = strenv(MIGRATE_IMAGE)' \
  migrate-job.yaml > /tmp/migrate-job-patched.yaml
kubectl apply -f /tmp/migrate-job-patched.yaml

# `kubectl wait` accepts one scalar --for value; repeating the flag does not race Complete
# and Failed (the last value wins). Poll both conditions so a failed Job aborts immediately
# rather than consuming the full deadline.
deadline=$((SECONDS + 600))
complete=""
while (( SECONDS < deadline )); do
  complete="$(kubectl -n "$NS" get job devstash-migrate \
    -o jsonpath='{.status.conditions[?(@.type=="Complete")].status}')"
  failed="$(kubectl -n "$NS" get job devstash-migrate \
    -o jsonpath='{.status.conditions[?(@.type=="Failed")].status}')"
  if [[ "$complete" == "True" ]]; then
    break
  fi
  if [[ "$failed" == "True" ]]; then
    echo "::error::migration job reached Failed condition"
    kubectl -n "$NS" logs job/devstash-migrate --tail=200 || true
    kubectl -n "$NS" describe job/devstash-migrate || true
    exit 1
  fi
  sleep 5
done
if [[ "${complete:-}" != "True" ]]; then
  echo "::error::migration job did not complete within 600s"
  kubectl -n "$NS" logs job/devstash-migrate --tail=200 || true
  kubectl -n "$NS" describe job/devstash-migrate || true
  exit 1
fi
kubectl -n "$NS" logs job/devstash-migrate --tail=50 || true
