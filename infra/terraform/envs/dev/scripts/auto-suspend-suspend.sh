#!/bin/sh
# Cloud Build step 4 — SUSPEND (only if idle; see auto-suspend.tf). $_VAR values are Cloud Build
# substitutions mapped onto the step env — the `script` field doesn't expand them in content —
# so plain POSIX shell. Now that the verified dump exists, drive to ~$0: destroy
# compute AND the Cloud SQL instance (db_active=false). -refresh=false keeps the apply (and
# this SA's perms) scoped to just what these two vars change.
set -eu
[ -f /workspace/SUSPEND ] || { echo "not idle — skipping suspend"; exit 0; }
cd /workspace/repo/infra/terraform/envs/dev
tofu init -input=false -backend-config="bucket=$_STATE_BUCKET"
tofu apply -input=false -auto-approve -refresh=false -var environment_active=false -var db_active=false
