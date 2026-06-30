#!/usr/bin/env bash
# One-shot: build the full local stack on kind and verify it. Idempotent-ish.
# The cloud analog is infra/gcp-run/run.sh; this mirrors its lifecycle on kind.
#
# Deployment flow mirrors GCP CI (.github/workflows/deploy-gke.yml):
#   1. Build images (web + migrator)
#   2. Apply infra (namespace, SA, ConfigMap, Secret, Service, Ingress, PDB, NetworkPolicy)
#   3. Gate: run the migrate Job, wait for completion
#   4. Roll out the web Deployment (same order as GCP: migrate → rollout)
#
# The Kubernetes manifests live in infra/k8s/overlays/local/ (mirrors overlays/gcp/).
# This directory (local-run/) contains only the orchestrator (run.sh) and the
# in-cluster backing services (Postgres, Redis, MinIO, Mailpit, dashboards).
#
# Usage:
#   bash infra/k8s/local-run/run.sh           bring the whole stack up (default)
#   bash infra/k8s/local-run/run.sh up        same as above
#   bash infra/k8s/local-run/run.sh deploy    rebuild images + re-run migrate + roll out (fast iterate)
#   bash infra/k8s/local-run/run.sh status    cluster / app / health summary
#   bash infra/k8s/local-run/run.sh info      print all service URLs (app, Postgres, MinIO, etc.)
#   bash infra/k8s/local-run/run.sh down      tear down the kind cluster
set -euo pipefail
cd "$(dirname "$0")/../../.."   # repo root

NS=devstash
HERE=infra/k8s/local-run
OVERLAY=infra/k8s/overlays/local

# ── Helper: run the migrate Job (delete-then-apply, then wait) ────────────────
# Mirrors the GCP CI gate: apply infra (everything except Deployment) first, then
# the migrate Job, then the Deployment. Keeps the same migrate→rollout ordering
# that prevents new code from reaching live pods before its schema migration lands.
run_migrate() {
  echo "--- running migrate job ---"
  kubectl -n "$NS" delete job devstash-migrate --ignore-not-found
  kubectl apply -f "$OVERLAY/migrate-job-local.yaml"
  if ! kubectl -n "$NS" wait --for=condition=complete \
      job/devstash-migrate --timeout=300s; then
    echo "ERROR: migrate job did not complete" >&2
    kubectl -n "$NS" logs job/devstash-migrate --tail=100 || true
    kubectl -n "$NS" describe job/devstash-migrate || true
    exit 1
  fi
  kubectl -n "$NS" logs job/devstash-migrate --tail=30 || true
  echo "--- migrate job complete ---"
}

up() {
  # 1. Cluster (skip if it already exists)
  kind get clusters | grep -qx devstash || kind create cluster --config "$HERE/kind-config.yaml"

  # 2. Build images: web (runtime) + migrator (Dockerfile --target migrator).
  #    Both are loaded into kind so no registry pull is needed.
  docker build -t devstash:local .
  docker build --target migrator -t devstash-migrate:local .
  kind load docker-image devstash:local         --name devstash
  kind load docker-image devstash-migrate:local --name devstash

  # 3. Namespace (created by the overlay's namespace.yaml via kustomize; also
  #    pre-create here so backing services can be applied before the app overlay).
  kubectl create namespace "$NS" --dry-run=client -o yaml | kubectl apply -f -

  # 4. Backing services (applied raw, NOT via the overlay kustomization):
  #    Postgres, Redis, MinIO, Mailpit. The overlay is the app under test, not
  #    its dependencies. Wait for each to be ready before running migrations.
  kubectl apply -f "$HERE/01-postgres.yaml" -f "$HERE/02-redis.yaml" -f "$HERE/05-minio-mailpit.yaml"
  kubectl -n "$NS" rollout status statefulset/postgres --timeout=120s
  kubectl -n "$NS" rollout status deploy/redis         --timeout=120s
  kubectl -n "$NS" rollout status deploy/minio         --timeout=120s
  kubectl -n "$NS" rollout status deploy/mailpit       --timeout=120s
  kubectl -n "$NS" wait --for=condition=complete job/minio-bucket-init --timeout=120s

  # 5. Apply infra from the local overlay — everything EXCEPT the Deployment.
  #    This creates the namespace, Secret (devstash-secrets), ConfigMap, Service,
  #    Ingress, HPA, PDB, and NetworkPolicy so the migrate Job can read the Secret.
  #    Mirrors the GCP CI "Apply infra (everything except the web Deployment)" step.
  kubectl kustomize "$OVERLAY" \
    | yq 'select(.kind != "Deployment")' \
    | kubectl apply --server-side -f -

  # 6. Migrate gate: run the migrate Job and wait for completion BEFORE the web
  #    Deployment rolls out. Same ordering as GCP — new code never reaches pods
  #    ahead of its schema migration.
  run_migrate

  # 7. Roll out the web Deployment (post-migration).
  kubectl kustomize "$OVERLAY" \
    | yq 'select(.kind == "Deployment")' \
    | kubectl apply --server-side -f -
  kubectl -n "$NS" rollout status deploy/devstash-web --timeout=180s

  # 8. Dashboards (not in the app overlay — applied separately as extras).
  kubectl apply -f "$HERE/06-headlamp.yaml"
  kubectl -n headlamp rollout status deploy/headlamp --timeout=120s
  kubectl apply -f "$HERE/07-pgadmin.yaml"
  kubectl -n "$NS" rollout status deploy/pgadmin --timeout=120s

  # 9. Verify
  echo "=== deep health (db + redis + s3 + email) ==="
  curl -s -w '\nHTTP %{http_code}\n' 'http://localhost:8080/api/health?deep=1'
  info
}

# Fast app-only iteration: rebuild images, reload into kind, re-run migrate, roll out.
# Backing services are assumed to be running (use `up` first).
deploy() {
  kind get clusters | grep -qx devstash || { echo "no kind cluster — run 'up' first" >&2; exit 1; }

  docker build -t devstash:local .
  docker build --target migrator -t devstash-migrate:local .
  kind load docker-image devstash:local         --name devstash
  kind load docker-image devstash-migrate:local --name devstash

  # Re-apply infra (namespace, Secret, ConfigMap, Service, Ingress, HPA, PDB, NetworkPolicy).
  kubectl kustomize "$OVERLAY" \
    | yq 'select(.kind != "Deployment")' \
    | kubectl apply --server-side -f -

  # Migrate gate before the Deployment rolls to the new image.
  run_migrate

  # Roll out the Deployment.
  kubectl kustomize "$OVERLAY" \
    | yq 'select(.kind == "Deployment")' \
    | kubectl apply --server-side -f -
  kubectl -n "$NS" rollout restart deploy/devstash-web
  kubectl -n "$NS" rollout status  deploy/devstash-web --timeout=180s

  echo "=== deep health ==="
  curl -s -w '\nHTTP %{http_code}\n' 'http://localhost:8080/api/health?deep=1'
}

status() {
  kind get clusters | grep -qx devstash || { echo "no kind cluster — run 'up' first" >&2; exit 1; }
  echo "=== workloads (ns: $NS) ==="
  kubectl -n "$NS" get deploy,statefulset,job,svc,pdb,hpa 2>/dev/null || true
  echo
  echo "=== app pods ==="
  kubectl -n "$NS" get pods -l app.kubernetes.io/name=devstash -o wide 2>/dev/null || true
  echo
  echo "=== deep health (db + redis + s3 + email) ==="
  curl -s -w '\nHTTP %{http_code}\n' 'http://localhost:8080/api/health?deep=1' || echo "app unreachable on :8080"
}

down() { kind delete cluster --name devstash; }

info() {
  echo "App:            http://localhost:8080"
  echo "Cluster UI:     http://localhost:8090  (Headlamp)"
  echo "  login token:  kubectl create token headlamp-admin -n headlamp"
  echo "Postgres:       psql postgresql://devstash:devstash@localhost:55432/devstash"
  echo "Postgres UI:    http://localhost:8978  (pgAdmin — login admin@devstash.dev/admin12345)"
  echo "Mailpit UI:     http://localhost:8025  (captured emails)"
  echo "MinIO console:  http://localhost:9001  (minioadmin/minioadmin)"
  echo "RedisInsight:   http://localhost:8001  (Redis web UI)"
  echo "Billing (Pro):  OFFLINE — grant Pro with a signed fake webhook (no Stripe acct):"
  echo "                STRIPE_WEBHOOK_SECRET=whsec_local_test \\"
  echo "                  npx tsx infra/k8s/local-run/stripe-fake-webhook.ts <userId> [active|canceled]"
}

case "${1:-up}" in
  up)     up ;;
  deploy) deploy ;;
  status) status ;;
  info)   info ;;
  down)   down ;;
  *) echo "unknown command '${1}' — one of: up | deploy | status | info | down" >&2; exit 1 ;;
esac
