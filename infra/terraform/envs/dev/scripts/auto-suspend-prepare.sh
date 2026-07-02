#!/bin/sh
# Cloud Build step 2 — PREPARE (only if idle; see auto-suspend.tf). $_VAR values are Cloud Build
# substitutions mapped onto the step env — the `script` field doesn't expand them in content —
# so plain POSIX shell. Clone the repo, drop the non-secret tfvars, reconstruct
# app/Spaceship secrets from Secret Manager into tofu-autoloaded *.auto.tfvars.json.
set -eu
[ -f /workspace/SUSPEND ] || { echo "not idle — skipping prepare"; exit 0; }
cd /workspace
# cloud-sdk:stable is built --no-install-recommends and no longer ships git on PATH, so a bare
# `git clone` exits 127 and aborts the whole suspend. Google's guidance is to extend the image
# (custom Dockerfile) or install what you need at runtime; a one-off apt-get here is far cheaper
# than owning a bespoke image for a single binary in a step that only runs when actually
# suspending. set -eu aborts if the install fails.
apt-get update -qq
apt-get install -y -qq --no-install-recommends git
git clone --depth 1 --branch "$_REPO_BRANCH" "https://github.com/$_REPO_SLUG.git" repo
echo "$_NONSECRET_B64" | base64 -d > repo/infra/terraform/envs/dev/zz-nonsecret.auto.tfvars.json
mkdir -p /workspace/sec
# All app credentials are now ONE consolidated JSON secret (devstash-app-config); fetch it
# once. The build helper extracts the third_party_secrets subset ($_SECRET_KEYS) from it so
# `tofu apply -var environment_active=false` re-supplies the required user keys (rather than
# wiping them). Spaceship DNS creds stay as their own opt-in secrets — fetched separately.
gcloud secrets versions access latest --secret="devstash-app-config" --project="$_PROJECT_ID" > /workspace/sec/app-config.json
for s in spaceship-api-key spaceship-api-secret; do
  if gcloud secrets describe "devstash-$s" --project="$_PROJECT_ID" >/dev/null 2>&1; then
    gcloud secrets versions access latest --secret="devstash-$s" --project="$_PROJECT_ID" > "/workspace/sec/$s"
  fi
done
# Assemble the secrets tfvars via the standalone Python helper (kept out of this shell step
# so the JSON-assembly logic is independently lintable/testable — not an inline heredoc).
# The repo was cloned to /workspace/repo above, so the script is on disk at this path.
python3 repo/infra/terraform/envs/dev/scripts/build-secrets-tfvars.py "$_SECRET_KEYS" \
  > repo/infra/terraform/envs/dev/zz-secrets.auto.tfvars.json
