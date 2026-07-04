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

# Shared log/ok/warn/die + need() — one logging/preflight vocabulary with gcp-run/run.sh.
# BASH_SOURCE[0] resolves the lib path regardless of the caller's CWD.
# shellcheck source=../../lib/common.sh
source "$(dirname "${BASH_SOURCE[0]}")/../../lib/common.sh"

NS=devstash
HERE=infra/k8s/local-run
OVERLAY=infra/k8s/overlays/local

# preflight: assert every CLI this local stack drives is on PATH before we start, so a
# missing tool fails fast with an install hint instead of a cryptic error deep in `up`.
preflight() {
  need docker  "https://docs.docker.com/get-docker/"
  need kind    "https://kind.sigs.k8s.io/docs/user/quick-start/#installation"
  need kubectl "https://kubernetes.io/docs/tasks/tools/"
  need yq      "brew install yq"
  need openssl "brew install openssl"
  need curl    "https://curl.se/download.html"
}

# ── Helper: self-signed TLS for local Valkey (mirrors GCP Memorystore) ────────
# GCP Memorystore for Valkey serves in-transit TLS (SERVER_AUTHENTICATION). To keep the
# local run on the SAME app code path (rediss:// + REDIS_CA_CERT verification, the TLS
# branch of redis-tcp.ts), generate a throwaway CA + server cert with openssl and load
# them into ONE Secret (valkey-tls). Both sides consume it: the Valkey pod mounts
# cert/key/ca to serve TLS; the app reads REDIS_CA_CERT from ca.crt (secretKeyRef in
# overlays/local/patches/app-local.yaml). Regenerated each `up` — the cluster is
# disposable, so key rotation on rebuild is fine. DRY: one CA, generated here, never
# committed to git. IAM auth is the one GCP feature not mirrored — Valkey OSS has no GCP
# IAM support, so the local instance stays no-auth over TLS (REDIS_IAM_AUTH unset).
ensure_valkey_tls() {
  local dir cnf
  dir="$(mktemp -d)"
  # The dir holds the throwaway CA private key (ca.key). Clean it on function RETURN so a
  # set -e abort in any openssl/kubectl step below can't leak private-key material on disk.
  trap 'rm -rf "$dir"' RETURN
  cnf="$HERE/valkey-openssl.cnf"
  log "generating local Valkey TLS certs (self-signed, dev-only)"
  # CA — the root of trust the app verifies the server cert against (REDIS_CA_CERT).
  openssl req -x509 -newkey rsa:4096 -nodes -sha256 -days 3650 \
    -keyout "$dir/ca.key" -out "$dir/ca.crt" -subj "/CN=devstash-local-valkey-ca"
  # Server key + CSR + cert signed by the CA, with SANs from the cnf (serverAuth EKU).
  openssl req -newkey rsa:2048 -nodes -sha256 \
    -keyout "$dir/tls.key" -out "$dir/tls.csr" -config "$cnf"
  openssl x509 -req -in "$dir/tls.csr" -CA "$dir/ca.crt" -CAkey "$dir/ca.key" \
    -CAcreateserial -sha256 -days 3650 \
    -extensions v3_req -extfile "$cnf" -out "$dir/tls.crt"
  kubectl -n "$NS" create secret generic valkey-tls \
    --from-file=ca.crt="$dir/ca.crt" \
    --from-file=tls.crt="$dir/tls.crt" \
    --from-file=tls.key="$dir/tls.key" \
    --dry-run=client -o yaml | kubectl apply -f -
  # $dir is removed by the RETURN trap set above (covers early set -e exits too).
}

# ── Helper: run the migrate Job (delete-then-apply, then wait) ────────────────
# Mirrors the GCP CI gate: apply infra (everything except Deployment) first, then
# the migrate Job, then the Deployment. Keeps the same migrate→rollout ordering
# that prevents new code from reaching live pods before its schema migration lands.
run_migrate() {
  log "running migrate job"
  kubectl -n "$NS" delete job devstash-migrate --ignore-not-found
  kubectl apply -f "$OVERLAY/migrate-job-local.yaml"
  if ! kubectl -n "$NS" wait --for=condition=complete \
      job/devstash-migrate --timeout=300s; then
    kubectl -n "$NS" logs job/devstash-migrate --tail=100 || true
    kubectl -n "$NS" describe job/devstash-migrate || true
    die "migrate job did not complete"
  fi
  kubectl -n "$NS" logs job/devstash-migrate --tail=30 || true
  ok "migrate job complete"
}

# ── Helper: build + load the web/migrator images into kind (shared by up + deploy) ────
build_and_load() {
  docker build -t devstash:local .
  docker build --target migrator -t devstash-migrate:local .
  kind load docker-image devstash:local         --name devstash
  kind load docker-image devstash-migrate:local --name devstash
}

# ── Helper: (re)create a ConfigMap from a single on-disk script ───────────────
# The backing-service manifests mount their init scripts from ConfigMaps so the shell stays in
# real, shellcheckable files (see infra/.agents/rules/infra.md — no inline scripts in YAML).
# Because those manifests are applied raw (not via kustomize configMapGenerator), run.sh
# materialises the ConfigMap here, idempotently, before the manifest that mounts it.
# $1 = ConfigMap name, $2 = path to the script file (its basename becomes the mounted key).
configmap_from_script() {
  kubectl -n "$NS" create configmap "$1" --from-file="$2" \
    --dry-run=client -o yaml | kubectl apply -f -
}

# ── Helper: render the local overlay and apply one kind slice server-side ─────
# The migrate gate requires infra (everything except the Deployment) to exist BEFORE the
# migrate Job, and the Deployment to roll out AFTER it — so up/deploy each apply the overlay
# in two slices. $1 is the yq kind filter, e.g. '!= "Deployment"' or '== "Deployment"'.
apply_overlay_slice() {
  kubectl kustomize "$OVERLAY" \
    | yq "select(.kind $1)" \
    | kubectl apply --server-side -f -
}

up() {
  preflight

  # 1. Cluster (skip if it already exists)
  kind get clusters | grep -qx devstash || kind create cluster --config "$HERE/kind-config.yaml"

  # 2. Build images: web (runtime) + migrator (Dockerfile --target migrator).
  #    Both are loaded into kind so no registry pull is needed.
  build_and_load

  # 3. Namespace (created by the overlay's namespace.yaml via kustomize; also
  #    pre-create here so backing services can be applied before the app overlay).
  kubectl create namespace "$NS" --dry-run=client -o yaml | kubectl apply -f -

  # 3b. TLS material for Valkey — must exist BEFORE the redis pod starts (it mounts the
  #     valkey-tls Secret to serve rediss://, mirroring GCP Memorystore SERVER_AUTHENTICATION).
  ensure_valkey_tls

  # 4. Backing services (applied raw, NOT via the overlay kustomization):
  #    Postgres, Redis, MinIO, Mailpit. The overlay is the app under test, not
  #    its dependencies. Wait for each to be ready before running migrations.
  #    The minio-bucket-init Job mounts its script from this ConfigMap — create it first.
  configmap_from_script minio-bucket-init-script "$HERE/scripts/minio-bucket-init.sh"
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
  apply_overlay_slice '!= "Deployment"'

  # 6. Migrate gate: run the migrate Job and wait for completion BEFORE the web
  #    Deployment rolls out. Same ordering as GCP — new code never reaches pods
  #    ahead of its schema migration.
  run_migrate

  # 7. Roll out the web Deployment (post-migration).
  apply_overlay_slice '== "Deployment"'
  kubectl -n "$NS" rollout status deploy/devstash-web --timeout=180s

  # 8. Dashboards (not in the app overlay — applied separately as extras).
  kubectl apply -f "$HERE/06-headlamp.yaml"
  kubectl -n headlamp rollout status deploy/headlamp --timeout=120s
  # pgAdmin's seed-pgpass initContainer mounts its script from this ConfigMap — create it first.
  configmap_from_script pgadmin-seed-script "$HERE/scripts/pgadmin-seed-pgpass.sh"
  kubectl apply -f "$HERE/07-pgadmin.yaml"
  kubectl -n "$NS" rollout status deploy/pgadmin --timeout=120s

  # 9. Verify
  log "deep health (db + redis + s3 + email)"
  curl -s -w '\nHTTP %{http_code}\n' 'http://localhost:8080/api/health?deep=1'
  info
}

# Fast app-only iteration: rebuild images, reload into kind, re-run migrate, roll out.
# Backing services are assumed to be running (use `up` first).
deploy() {
  preflight
  kind get clusters | grep -qx devstash || die "no kind cluster — run 'up' first"

  build_and_load

  # Re-apply infra (namespace, Secret, ConfigMap, Service, Ingress, HPA, PDB, NetworkPolicy).
  apply_overlay_slice '!= "Deployment"'

  # Migrate gate before the Deployment rolls to the new image.
  run_migrate

  # Roll out the Deployment.
  apply_overlay_slice '== "Deployment"'
  kubectl -n "$NS" rollout restart deploy/devstash-web
  kubectl -n "$NS" rollout status  deploy/devstash-web --timeout=180s

  log "deep health"
  curl -s -w '\nHTTP %{http_code}\n' 'http://localhost:8080/api/health?deep=1'
}

status() {
  kind get clusters | grep -qx devstash || die "no kind cluster — run 'up' first"
  log "workloads (ns: $NS)"
  kubectl -n "$NS" get deploy,statefulset,job,svc,pdb,hpa 2>/dev/null || true
  log "app pods"
  kubectl -n "$NS" get pods -l app.kubernetes.io/name=devstash -o wide 2>/dev/null || true
  log "deep health (db + redis + s3 + email)"
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
  echo "Valkey:         kubectl -n devstash exec deploy/redis -- redis-cli --tls --cacert /tls/ca.crt  (TLS, no bundled web UI)"
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
  *) die "unknown command '${1}' — one of: up | deploy | status | info | down" ;;
esac
