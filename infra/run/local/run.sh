#!/usr/bin/env bash
# One-shot: build the full local stack on kind and verify it. Idempotent-ish.
# The cloud analog is infra/run/gcp/run.sh; this mirrors its lifecycle on kind.
#
# Deployment flow mirrors GCP CI (.github/workflows/deploy-gke.yml):
#   1. Build images (web + migrator)
#   2. Apply infra (namespace, SA, ConfigMap, Secret, Service, Ingress, PDB, NetworkPolicy)
#   3. Gate: run the migrate Job, wait for completion
#   4. Roll out the web Deployment (same order as GCP: migrate → rollout)
#
# The app manifests live in infra/k8s/overlays/local/ (mirrors overlays/gcp/); the in-cluster
# backing services (Postgres, Redis, MinIO, Mailpit, dashboards) live in the kustomize base
# infra/k8s/local/. This directory (infra/run/local/) holds only the orchestrator (run.sh)
# and its sidecars (valkey-openssl.cnf, stripe-fake-webhook.ts).
#
# Usage:
#   bash infra/run/local/run.sh           bring the whole stack up (default)
#   bash infra/run/local/run.sh up        same as above
#   bash infra/run/local/run.sh deploy    rebuild images + re-run migrate + roll out (fast iterate)
#   bash infra/run/local/run.sh status    cluster / app / health summary
#   bash infra/run/local/run.sh info      print all service URLs (app, Postgres, MinIO, etc.)
#   bash infra/run/local/run.sh down      tear down the kind cluster
set -euo pipefail
# Fail LOUD, never silently — same ERR trap as the sibling gcp/run.sh (which documents the full
# rationale). Under `set -e` any un-guarded non-zero command (a kubectl/kind/tofu/openssl call
# mid-`up`) would otherwise abort with no clue where; this turns each death into an actionable
# report (failing command + exit code + file:line). Self-contained (raw ANSI, bash builtins) so
# it works even before common.sh is sourced below.
# shellcheck disable=SC2154  # rc IS assigned (rc=$?) and used ("$rc") within this trap string; shellcheck can't see across the trap boundary.
trap 'rc=$?; printf "\n\033[0;31m✖ local/run.sh FAILED\033[0m — %s:%d\n    command: %s\n    exit code: %d\n" "${BASH_SOURCE[0]}" "$LINENO" "$BASH_COMMAND" "$rc" >&2' ERR
cd "$(dirname "$0")/../../.."   # repo root

# Shared log/ok/warn/die + need() — one logging/preflight vocabulary with run/gcp/run.sh.
# BASH_SOURCE[0] resolves the lib path regardless of the caller's CWD.
# shellcheck source=../../lib/common.sh
source "$(dirname "${BASH_SOURCE[0]}")/../../lib/common.sh"

NS="$DEVSTASH_NS"
# HERE = this orchestrator's own dir (valkey cnf, tofu state live beside run.sh).
# LOCAL_K8S = the backing-services kustomize base (Postgres/Redis/MinIO/Mailpit/dashboards +
# their init-script ConfigMaps + kind-config.yaml). OVERLAY = the app-under-test overlay.
HERE=infra/run/local
LOCAL_K8S=infra/k8s/local
OVERLAY=infra/k8s/overlays/local

# OpenTofu drives cluster creation (the local analog of infra/run/gcp/run.sh's GKE flow).
# TF_DIR is the envs/local root; the local-file backend keeps its state HERE (gitignored) so
# a `down` can destroy exactly what `up` created, and so the cluster is state-tracked rather
# than being an untracked `kind create`.
TF_DIR=infra/terraform/envs/local
TF_STATE="$HERE/.tofu-state/local.tfstate"
tofu_() { tofu -chdir="$TF_DIR" "$@"; }
# tofu_init_local: `tofu init` against the local-file backend, passing the state path as an
# absolute path (the partial backend-config envs/local/backend.tf leaves unset). Both cluster_up
# and cluster_down must init with the identical path before apply/destroy, so it lives here once.
tofu_init_local() {
  tofu_ init -input=false \
    -backend-config="path=$(cd "$(dirname "$TF_STATE")" && pwd)/$(basename "$TF_STATE")"
}

# preflight: assert every CLI this local stack drives is on PATH before we start, so a
# missing tool fails fast with an install hint instead of a cryptic error deep in `up`.
preflight() {
  need docker  "https://docs.docker.com/get-docker/"
  need kind    "https://kind.sigs.k8s.io/docs/user/quick-start/#installation"
  need tofu    "https://opentofu.org/docs/intro/install (or use terraform)"
  need kubectl "https://kubernetes.io/docs/tasks/tools/"
  need yq      "brew install yq"
  need openssl "brew install openssl"
  need curl    "https://curl.se/download.html"
  need jq      "brew install jq"
}

# deep_health_check: print the deep health-check body (for the human to read, unlike gcp/run.sh's
# silent _app_healthy poll-loop gate) AND warn if it doesn't actually report healthy. WHY the
# warn: HTTP 200 alone doesn't mean healthy — the same footgun _app_healthy (gcp/run.sh) guards
# against applies here too: the endpoint can return 200 with {"status":"error","db":"..."} while
# Postgres/Redis/MinIO is still coming up, and a human skimming the printed JSON could miss that.
deep_health_check() {
  local url='http://localhost:8080/api/health?deep=1' body
  body="$(curl -s --max-time 10 "$url")" || {
    warn "app unreachable on :8080"
    return 0
  }
  printf '%s\n' "$body"
  # Delegate the verdict to the shared health contract (common.sh); print-the-body stays local.
  ds_health_ok "$url" \
    || warn "deep health check did not report status=ok — inspect the body above"
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
  # RETURN traps aren't function-scoped — they fire on every later function return too — so
  # clear it explicitly before returning instead of just letting the function end.
  trap 'rm -rf "$dir"; trap - RETURN' RETURN
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
  kubectl -n "$NS" delete job devstash-migrate --ignore-not-found --cascade=foreground
  kubectl apply -f "$OVERLAY/migrate-job-local.yaml"
  # Gate on the Job's terminal condition (Complete/Failed/timeout) via the shared poll loop, so a
  # broken migration aborts immediately instead of burning the full deadline. wait_for_job_gate
  # (common.sh) dumps diagnostics on any non-zero code; we map the code to the local `die` wording.
  # Mirrors infra/ci/run-migrations.sh, which wraps the SAME helper with its own ::error:: message.
  # `|| gate_rc=$?` keeps the non-zero return from tripping set -e (diagnostics already printed).
  local gate_rc=0
  wait_for_job_gate "$NS" devstash-migrate 300 || gate_rc=$?
  case "$gate_rc" in
    0) : ;;
    1) die "migrate job reached Failed condition" ;;
    *) die "migrate job did not complete within 300s" ;;
  esac
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

# ── Helper: render a kustomize dir and apply the slice matched by a yq select expr ─────
# Renders <dir>, keeps the docs matching the full yq boolean expression <expr> (passed whole —
# e.g. a .metadata.name test for the backing-services base, or `.kind == "Deployment"` for the
# app overlay), and applies them with any extra kubectl-apply args (the overlay slices pass
# --server-side). The base up-flow must stage data services (Postgres/Redis/MinIO/Mailpit)
# BEFORE the migrate gate and the dashboards (Headlamp/pgAdmin) AFTER the app rolls out; the
# overlay must apply infra before the migrate Job and the Deployment after — so both render
# once (configMapGenerator materialises the init-script ConfigMaps) and apply in complementary
# slices through this one helper. The generated ConfigMaps ride along with whichever slice
# mounts them (name match below).
apply_slice() {
  local dir="$1" expr="$2"; shift 2
  kubectl kustomize "$dir" | yq "select($expr)" | kubectl apply "$@" -f -
}

# The dashboards (Headlamp + pgAdmin) and their objects, by name — the one group held back
# until after the app rolls out. Slice 1 (data services) is the complement of this set;
# slice 2 (dashboards) is this set. Kept as a single yq predicate so the two slices stay
# exact complements and can never overlap or drop a resource.
DASHBOARD_NAMES='["headlamp","headlamp-admin","pgadmin","pgadmin-config","pgadmin-seed-script"]'

# ── Helper: provision the kind cluster via OpenTofu (envs/local) ──────────────
# Mirrors infra/run/gcp/run.sh's tofu flow (init -backend-config → apply), scaled down to a
# single kind_cluster resource. The local-file backend's state path is supplied at init via a
# partial backend-config (envs/local/backend.tf is `backend "local" {}` with no path), exactly
# as the GCP env passes its GCS bucket. cluster_active=true is the resume state; run.sh `down`
# flips it false through cluster_down. Idempotent: a second `up` re-applies to no-op if the
# cluster already exists in state. The tofu-managed cluster replaces the old bare
# `kind create cluster --config kind-config.yaml` — same config file, now referenced by the
# kind module via path.
cluster_up() {
  mkdir -p "$(dirname "$TF_STATE")"
  log "provisioning kind cluster via OpenTofu (envs/local)"
  tofu_init_local
  tofu_ apply -input=false -auto-approve -var cluster_active=true
}

# ── Helper: destroy the kind cluster via OpenTofu (state-tracked teardown) ─────
# The counterpart to cluster_up. tofu destroy removes exactly what the state tracks (the one
# kind_cluster), replacing the old untracked `kind delete cluster`. Re-init first so a `down`
# on a fresh checkout (no .terraform) still resolves the backend path.
cluster_down() {
  [[ -f "$TF_STATE" ]] || { warn "no local tofu state — nothing to destroy"; return 0; }
  log "destroying kind cluster via OpenTofu (envs/local)"
  tofu_init_local
  tofu_ destroy -input=false -auto-approve
}

up() {
  preflight

  # 1. Cluster — provisioned by OpenTofu (state-tracked). The kind module reuses this
  #    directory's kind-config.yaml by path, so the node/port-mapping layout is unchanged.
  cluster_up

  # 1b. Guard: kind switches kubectl's current-context to kind-devstash as a side effect of
  #     cluster creation, so this must run AFTER cluster_up, not before. Prevents applying the
  #     local-only backing-services base onto whatever cluster kubectl happened to be pointed
  #     at (e.g. GKE dev, left active by a prior `gcp/run.sh apply`).
  require_kube_context "kind-devstash" "run: kubectl config use-context kind-devstash"

  # 2. Build images: web (runtime) + migrator (Dockerfile --target migrator).
  #    Both are loaded into kind so no registry pull is needed.
  build_and_load

  # 3. Namespace (created by the overlay's namespace.yaml via kustomize; also
  #    pre-create here so backing services can be applied before the app overlay).
  kubectl create namespace "$NS" --dry-run=client -o yaml | kubectl apply -f -

  # 3b. TLS material for Valkey — must exist BEFORE the redis pod starts (it mounts the
  #     valkey-tls Secret to serve rediss://, mirroring GCP Memorystore SERVER_AUTHENTICATION).
  ensure_valkey_tls

  # 4. Backing services from the base ($LOCAL_K8S), NOT the app overlay: Postgres, Redis,
  #    MinIO, Mailpit + the minio-bucket-init Job and its generated init-script ConfigMap.
  #    The dashboards (Headlamp/pgAdmin) are held back to step 8 (post-app). Wait for each
  #    to be ready before running migrations.
  apply_slice "$LOCAL_K8S" "(.metadata.name as \$n | $DASHBOARD_NAMES | contains([\$n]) | not)"
  kubectl -n "$NS" rollout status statefulset/postgres --timeout=120s
  kubectl -n "$NS" rollout status deploy/redis         --timeout=120s
  kubectl -n "$NS" rollout status deploy/minio         --timeout=120s
  kubectl -n "$NS" rollout status deploy/mailpit       --timeout=120s
  kubectl -n "$NS" wait --for=condition=complete job/minio-bucket-init --timeout=120s

  # 5. Apply infra from the local overlay — everything EXCEPT the Deployment.
  #    This creates the namespace, Secret (devstash-secrets), ConfigMap, Service,
  #    Ingress, HPA, PDB, and NetworkPolicy so the migrate Job can read the Secret.
  #    Mirrors the GCP CI "Apply infra (everything except the web Deployment)" step.
  apply_slice "$OVERLAY" '.kind != "Deployment"' --server-side

  # 6. Migrate gate: run the migrate Job and wait for completion BEFORE the web
  #    Deployment rolls out. Same ordering as GCP — new code never reaches pods
  #    ahead of its schema migration.
  run_migrate

  # 7. Roll out the web Deployment (post-migration).
  apply_slice "$OVERLAY" '.kind == "Deployment"' --server-side
  kubectl -n "$NS" rollout status deploy/devstash-web --timeout=180s

  # 8. Dashboards (Headlamp + pgAdmin) — the held-back slice of the base, applied post-app.
  #    pgAdmin's seed-pgpass initContainer mounts its script from the pgadmin-seed-script
  #    ConfigMap, which the base generates and this slice carries.
  apply_slice "$LOCAL_K8S" "(.metadata.name as \$n | $DASHBOARD_NAMES | contains([\$n]))"
  kubectl -n headlamp rollout status deploy/headlamp --timeout=120s
  kubectl -n "$NS" rollout status deploy/pgadmin --timeout=120s

  # 9. Verify
  log "deep health (db + redis + s3 + email)"
  deep_health_check
  info
}

# Fast app-only iteration: rebuild images, reload into kind, re-run migrate, roll out.
# Backing services are assumed to be running (use `up` first).
deploy() {
  preflight
  kind get clusters | grep -qx devstash || die "no kind cluster — run 'up' first"
  require_kube_context "kind-devstash" "run: kubectl config use-context kind-devstash"

  build_and_load

  # Re-apply infra (namespace, Secret, ConfigMap, Service, Ingress, HPA, PDB, NetworkPolicy).
  apply_slice "$OVERLAY" '.kind != "Deployment"' --server-side

  # Migrate gate before the Deployment rolls to the new image.
  run_migrate

  # Roll out the Deployment.
  apply_slice "$OVERLAY" '.kind == "Deployment"' --server-side
  kubectl -n "$NS" rollout restart deploy/devstash-web
  kubectl -n "$NS" rollout status  deploy/devstash-web --timeout=180s

  log "deep health"
  deep_health_check
}

status() {
  kind get clusters | grep -qx devstash || die "no kind cluster — run 'up' first"
  log "workloads (ns: $NS)"
  kubectl -n "$NS" get deploy,statefulset,job,svc,pdb,hpa 2>/dev/null || true
  log "app pods"
  kubectl -n "$NS" get pods -l app.kubernetes.io/name=devstash -o wide 2>/dev/null || true
  log "deep health (db + redis + s3 + email)"
  deep_health_check
}

down() { cluster_down; }

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
  echo "                  npx tsx infra/run/local/stripe-fake-webhook.ts <userId> [active|canceled]"
}

case "${1:-up}" in
  up)     up ;;
  deploy) deploy ;;
  status) status ;;
  info)   info ;;
  down)   down ;;
  *) die "unknown command '${1}' — one of: up | deploy | status | info | down" ;;
esac
