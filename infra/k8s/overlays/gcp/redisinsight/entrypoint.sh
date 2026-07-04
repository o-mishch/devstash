#!/bin/sh
# Start wrapper for the on-demand RedisInsight debugging pod. Mounted read-only at
# /scripts from the `redisinsight-entrypoint` ConfigMap (generated from THIS file by
# kustomize) and run via `/bin/sh /scripts/entrypoint.sh`.
#
# It mints a fresh Valkey IAM access token from the GKE metadata server (Workload
# Identity), derives host/port from the live devstash-secrets REDIS_URL, points
# RedisInsight at the CA mounted at /certs/ca.pem, and preconfigures a single TLS
# connection — so the UI opens already connected. Nothing is hardcoded; every value is
# resolved at pod start.
#
# Setting `command` in the Deployment overrides the image ENTRYPOINT, so we re-exec the
# image's own docker-entry.sh + CMD (`node redisinsight/api/dist/src/main`) at the end.
# -u: an unset REDIS_URL/TOKEN must fail fast, not silently yield an empty host or an
# empty Valkey password (which would open the UI unauthenticated against the wrong target).
set -eu

# REDIS_URL is the one required input — fail with a clear message rather than deriving an
# empty host:port from an unset var (which -u catches, but the message here is actionable).
[ -n "${REDIS_URL:-}" ] || { echo "[redisinsight-init] REDIS_URL is not set — cannot derive Valkey host:port" >&2; exit 1; }

echo "[redisinsight-init] minting Valkey IAM access token via Workload Identity"
# `node` (with global fetch) is guaranteed present in the image; curl/wget may not be.
TOKEN=$(node -e 'fetch("http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/token",{headers:{"Metadata-Flavor":"Google"}}).then(r=>r.json()).then(d=>process.stdout.write(d.access_token)).catch(e=>{console.error(e);process.exit(1)})')
# A fetch can return 200 with no access_token (e.g. SA misconfig) — node then prints nothing
# and exits 0, so `set -e` won't catch it. Guard explicitly so an empty token never becomes
# the Valkey password (which would silently authenticate as no-password).
[ -n "$TOKEN" ] || { echo "[redisinsight-init] metadata server returned an empty access token — check the pod's Workload Identity binding" >&2; exit 1; }

# REDIS_URL is rediss://host:port (credential-less, from the live Secret).
HOSTPORT=${REDIS_URL#*://}
RI_REDIS_HOST=${HOSTPORT%%:*}
RI_REDIS_PORT=${HOSTPORT##*:}
export RI_REDIS_HOST RI_REDIS_PORT
export RI_REDIS_USERNAME=default
export RI_REDIS_PASSWORD="$TOKEN"
export RI_REDIS_TLS=true
export RI_REDIS_TLS_CA_PATH=/certs/ca.pem
export RI_REDIS_ALIAS="devstash-dev (Valkey)"
export RI_ACCEPT_TERMS_AND_CONDITIONS=true

echo "[redisinsight-init] preconfigured ${RI_REDIS_HOST}:${RI_REDIS_PORT} over TLS (token len ${#TOKEN})"
cd /usr/src/app
exec ./docker-entry.sh node redisinsight/api/dist/src/main
