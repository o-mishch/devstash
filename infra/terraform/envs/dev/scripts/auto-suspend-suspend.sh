#!/bin/sh
# Cloud Build step 4 — SUSPEND (only if idle; see auto-suspend.tf). $_VAR values are Cloud Build
# substitutions mapped onto the step env — the `script` field doesn't expand them in content —
# so plain POSIX shell. Now that the verified dump exists, drive to ~$0: destroy
# compute AND the Cloud SQL instance (db_active=false). -refresh=false keeps the apply (and
# this SA's perms) scoped to just what these two vars change.
#
# Before the apply it runs the same stranded-AR-IAM reconcile (branch 4) that run.sh's
# reconcile_state runs on the laptop path, so the unattended suspend recovers from a pre-fix
# stranding instead of 403-wedging every tick — behaviourally matching `run.sh suspend`. The
# reconcile LOOP itself is now the SHARED POSIX helper ds_purge_stranded_ar_iam (see below), so it
# can no longer drift from the bash reconcile.sh — same discipline as the dump/reap steps.
set -eu
[ -f /workspace/SUSPEND ] || { echo "not idle — skipping suspend"; exit 0; }
cd /workspace/repo/infra/terraform/envs/dev
tofu init -input=false -backend-config="bucket=$_STATE_BUCKET"

# RECONCILE (branch 4) — heal an ALREADY-STRANDED repo-scoped AR-IAM state before the apply, so
# the unattended path recovers from a pre-fix stranding exactly as run.sh's reconcile_state does on
# the laptop path (infra/run/gcp/lib/reconcile.sh branch 4). A pre-destroy-order-fix suspend
# destroyed the repo first, then 403'd removing these members via the now-vanished repo, leaving them
# in state; the apply below would 403 AGAIN and re-wedge every scheduled tick with no unattended
# recovery. ds_purge_stranded_ar_iam (infra/lib/posix/reconcile-ar-iam.sh) is the ONE describe-gate +
# exact-address state-check + `tofu state rm` loop this step and reconcile.sh both run — the surrounding
# comment above explains the WHY; the helper header explains the mechanics. Sourced from the
# /workspace/repo clone step 2 (prepare) made; the addresses stay in the committed data file
# infra/lib/ar-iam-member-addresses.txt (passed in), so BOTH the data AND the loop are single-sourced.
# shellcheck source=infra/lib/posix/reconcile-ar-iam.sh
. /workspace/repo/infra/lib/posix/reconcile-ar-iam.sh
ds_purge_stranded_ar_iam devstash "$_REGION" "$_PROJECT_ID" \
  /workspace/repo/infra/lib/ar-iam-member-addresses.txt

# -lock-timeout=120s: the guard (step 1) checked the state lock was free, but steps 2-4 (clone,
# secret fetch, dump) take minutes, during which a human `run.sh apply` could acquire the lock.
# Without a timeout tofu's default is fail-immediately (0s), wedging the suspend on a briefly-held
# lock (self-heals next scheduler tick, but leaves the env billing meanwhile). Waiting 120s
# mirrors the human side's symmetry (run.sh apply also uses -lock-timeout=120s) so whichever
# grabs the lock first, the other waits it out instead of erroring.
tofu apply -input=false -auto-approve -refresh=false -lock-timeout=120s \
  -var environment_active=false -var db_active=false
