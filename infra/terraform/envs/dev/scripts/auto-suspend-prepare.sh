#!/bin/sh
# Cloud Build step 2 — PREPARE (only if idle; see auto-suspend.tf). $_VAR values are Cloud Build
# substitutions mapped onto the step env — the `script` field doesn't expand them in content —
# so plain POSIX shell. Clone the repo, drop the non-secret tfvars, reconstruct
# app/Spaceship secrets from Secret Manager into tofu-autoloaded *.auto.tfvars.json.
set -eu
[ -f /workspace/SUSPEND ] || { echo "not idle — skipping prepare"; exit 0; }
cd /workspace
# cloud-sdk:slim ships gcloud + git + python3 + ca-certificates, so nothing is installed at
# runtime. The guard may already have shallow-cloned the repo (idle-traffic path); reuse it,
# otherwise clone now (the uptime-cap path reaches prepare without a prior clone).
[ -d repo ] || git clone --depth 1 --branch "$_REPO_BRANCH" "https://github.com/$_REPO_SLUG.git" repo
echo "$_NONSECRET_B64" | base64 -d > repo/infra/terraform/envs/dev/zz-nonsecret.auto.tfvars.json
mkdir -p /workspace/sec
# All app credentials are now ONE consolidated JSON secret (devstash-app-config); fetch it
# once. The build helper extracts the third_party_secrets subset ($_SECRET_KEYS) from it so
# `tofu apply -var environment_active=false` re-supplies the required user keys (rather than
# wiping them). Ops-only DNS creds are ALSO one consolidated JSON secret (devstash-ops-config,
# spaceship-api-key/-secret properties) — fetch it as a whole blob if present (opt-in: a
# project without DNS creds omits it). The Python helper splits the blob into the two tfvars.
# Resolve the newest ENABLED version rather than `access latest`: `latest` points at the
# highest-numbered version regardless of state, so a single DISABLED/DESTROYED top version
# (e.g. left by an interrupted rotation) makes `access latest` fail with FAILED_PRECONDITION
# and blocks the whole suspend — the outage the secret_data_wo redesign (modules/iam) was
# meant to end, still reachable via a stray disabled version. Pick the newest state:ENABLED
# version explicitly so one bad top version can never wedge suspend again.
app_config_ver="$(gcloud secrets versions list devstash-app-config --project="$_PROJECT_ID" \
  --filter=state:ENABLED --sort-by=~createTime --limit=1 --format='value(name)')"
[ -n "$app_config_ver" ] || { echo "devstash-app-config has no ENABLED version — cannot proceed"; exit 1; }
gcloud secrets versions access "$app_config_ver" --secret="devstash-app-config" --project="$_PROJECT_ID" > /workspace/sec/app-config.json
if gcloud secrets describe "devstash-ops-config" --project="$_PROJECT_ID" >/dev/null 2>&1; then
  gcloud secrets versions access latest --secret="devstash-ops-config" --project="$_PROJECT_ID" > /workspace/sec/ops-config.json
fi
# Assemble the secrets tfvars via the standalone Python helper (kept out of this shell step so
# the JSON-assembly logic is independently lintable/testable and languages stay segregated — not
# an inline heredoc). The repo was cloned above, so the script is on disk at this path.
python3 repo/infra/terraform/envs/dev/scripts/build-secrets-tfvars.py "$_SECRET_KEYS" \
  > repo/infra/terraform/envs/dev/zz-secrets.auto.tfvars.json
