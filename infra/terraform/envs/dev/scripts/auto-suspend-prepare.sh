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
# fetch_enabled_secret <secret-name> <out-file>: resolve the secret's newest ENABLED version
# and access it into <out-file>, dying if there is no ENABLED version. Resolve the newest
# ENABLED version rather than `access latest`: `latest` points at the highest-numbered version
# regardless of state, so a single DISABLED/DESTROYED top version (e.g. left by an interrupted
# rotation) makes `access latest` fail with FAILED_PRECONDITION and blocks the whole suspend —
# the outage the secret_data_wo redesign (modules/iam) was meant to end, still reachable via a
# stray disabled version. This mirrors ds_newest_enabled_secret_version (infra/lib/common.sh),
# which this /bin/sh Cloud Build template cannot source — keep the two in sync.
fetch_enabled_secret() {
  _ver="$(gcloud secrets versions list "$1" --project="$_PROJECT_ID" \
    --filter=state:ENABLED --sort-by=~createTime --limit=1 --format='value(name)')"
  [ -n "$_ver" ] || { echo "$1 has no ENABLED version — cannot proceed"; exit 1; }
  gcloud secrets versions access "$_ver" --secret="$1" --project="$_PROJECT_ID" > "$2"
}
fetch_enabled_secret devstash-app-config /workspace/sec/app-config.json
# Ops-only DNS creds are opt-in — a project without DNS creds omits the secret entirely, so
# only fetch it when it exists. Same newest-ENABLED-version resolution as app-config above.
if gcloud secrets describe "devstash-ops-config" --project="$_PROJECT_ID" >/dev/null 2>&1; then
  fetch_enabled_secret devstash-ops-config /workspace/sec/ops-config.json
fi
# Assemble the secrets tfvars via the standalone Python helper (kept out of this shell step so
# the JSON-assembly logic is independently lintable/testable and languages stay segregated — not
# an inline heredoc). The repo was cloned above, so the script is on disk at this path.
python3 repo/infra/terraform/envs/dev/scripts/build-secrets-tfvars.py "$_SECRET_KEYS" \
  > repo/infra/terraform/envs/dev/zz-secrets.auto.tfvars.json
