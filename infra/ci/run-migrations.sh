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
#   MIGRATE_IMAGE  — job-level env in the `deploy` job, reconstructed from the
#                    `build-push` job's outputs (repo@sha256:… digest-pinned reference)
# shellcheck source=infra/lib/common.sh
source "$(dirname "${BASH_SOURCE[0]}")/../lib/common.sh"

set -euo pipefail

NS="$DEVSTASH_NS"

# Navigate to the repository root directory.
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$REPO_ROOT"

# ALWAYS run the migrate Job — never skip on a heuristic. `prisma migrate deploy` (step 1 of
# the migrate image CMD) is idempotent by design: it applies only pending migrations and is a
# fast no-op when the schema is already current, and the seed (SEED_ITEM_TYPES_ONLY) is
# idempotent upserts. The old skip compared a `git diff -- prisma` against the SHA annotation
# on the running Deployment, but a clean file-diff does NOT prove the DB schema is current: a
# `run.sh resume` restores the DB from a possibly-older GCS dump (or the schema drifts
# out-of-band) with the prisma/ files unchanged, so the skip would ship new code against an
# un-migrated schema. Running the idempotent Job unconditionally is both correct and cheap —
# the one-shot pod (250m/512Mi) finishes in seconds when nothing is pending, and only ever
# runs during an active deploy, never at idle, so it does not affect the ~$0 suspended cost.
echo "Running the migrate Job unconditionally (prisma migrate deploy is idempotent)."

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
# tracked source. --wait (default) + --cascade=foreground blocks until the old Job AND its
# pod are fully gone, so the immediate apply below can't race a still-terminating pod and
# fail with "object is being deleted".
kubectl -n "$NS" delete job devstash-migrate --ignore-not-found --cascade=foreground
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
    ds_dump_job_diagnostics "$NS" devstash-migrate
    exit 1
  fi
  sleep 5
done
if [[ "${complete:-}" != "True" ]]; then
  echo "::error::migration job did not complete within 600s"
  ds_dump_job_diagnostics "$NS" devstash-migrate
  exit 1
fi
kubectl -n "$NS" logs job/devstash-migrate --tail=50 || true
