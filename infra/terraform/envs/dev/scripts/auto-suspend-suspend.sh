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
# -lock-timeout=120s: the guard (step 1) checked the state lock was free, but steps 2-4 (clone,
# secret fetch, dump) take minutes, during which a human `run.sh apply` could acquire the lock.
# Without a timeout tofu's default is fail-immediately (0s), wedging the suspend on a briefly-held
# lock (self-heals next scheduler tick, but leaves the env billing meanwhile). Waiting 120s
# mirrors the human side's symmetry (run.sh apply also uses -lock-timeout=120s) so whichever
# grabs the lock first, the other waits it out instead of erroring.
tofu apply -input=false -auto-approve -refresh=false -lock-timeout=120s \
  -var environment_active=false -var db_active=false
