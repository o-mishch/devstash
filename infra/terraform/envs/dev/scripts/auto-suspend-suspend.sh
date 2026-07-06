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

# STATE-LOCK CONTENTION (layers 2 + 3). The guard (step 1) now dedups concurrent auto-suspend builds
# (layer 1), but a residual race remains: two builds can pass the guard within the same createTime
# second, or a human `run.sh apply` can grab the lock during steps 2-4 (clone, secret fetch, dump,
# which take minutes). Two defences, single-sourced in infra/lib/posix/lock-contention.sh:
#
#   • -lock-timeout=900s (layer 2, raised from 120s): a losing build now WAITS OUT the holder instead
#     of erroring. 900s covers a full GKE+SQL destroy (the holder's work) and matches run.sh's
#     wait_for_no_autosuspend_build cap — whoever grabs the lock first, the other waits, symmetric
#     with the human side.
#   • ds_force_unlock_if_dead (layer 3): if the apply STILL fails to get the lock past that timeout,
#     recover ONLY when the lock is orphaned (no auto-suspend build is running — a crashed holder).
#     If a sibling is still live it is a legitimate destroy in progress → do NOT unlock; this build
#     exits 0 as a benign no-op (the sibling completes the suspend). Never breaks a live apply.
# shellcheck source=infra/lib/posix/lock-contention.sh
. /workspace/repo/infra/lib/posix/lock-contention.sh

# apply, retrying ONCE if — and ONLY if — the first attempt fails specifically on LOCK ACQUISITION.
# tofu's output is tee'd to a log so the failure can be classified: a lock stalemate carries the
# fixed "Error acquiring the state lock" string, whereas a real plan/apply error does not. This gate
# is essential — WITHOUT it, layer 3 would run on ANY failure and could force-unlock + retry (or
# worse, exit 0) on a genuine destroy error, masking it from the failure alert.
#
# POSIX sh has no `set -o pipefail`, so `tee` (the last pipe stage) would mask tofu's exit status.
# Recover tofu's real status by recording it to a file inside the pipe's first stage, then returning
# it after the pipe completes.
run_apply() {
  { tofu apply -input=false -auto-approve -refresh=false -lock-timeout=900s \
      -var environment_active=false -var db_active=false 2>&1; echo "$?" > /workspace/apply.rc; } \
    | tee /workspace/suspend-apply.log
  return "$(cat /workspace/apply.rc)"
}
if ! run_apply; then
  # The apply failed. Only treat it as recoverable lock contention if tofu SAID so — otherwise it is
  # a real error: re-emit nothing and exit non-zero (set -e via the explicit exit) to fire the alert.
  if ! grep -q "Error acquiring the state lock" /workspace/suspend-apply.log; then
    echo "suspend apply failed for a non-lock reason — surfacing the error (alert will fire)"
    exit 1
  fi
  # It IS a lock stalemate. Ask the helper whether the lock is safe to break: it returns 0 only when
  # the lock is gone/orphaned (no auto-suspend build running — force-unlocks an orphan), and 1 when a
  # sibling still holds it live OR the lock ID couldn't be read. On 0, retry the apply once; a second
  # failure is a real error and propagates (set -e). On 1, exit 0 as a benign concurrency no-op.
  if ds_force_unlock_if_dead "$_REGION" "$_PROJECT_ID" "$_STATE_BUCKET" \
       "$_TRIGGER_NAME" "$_BUILD_ID" \
       /workspace/repo/infra/terraform/envs/dev/scripts/auto-suspend-lock-id.py; then
    echo "retrying the suspend apply after clearing the stale lock"
    run_apply
  else
    echo "another auto-suspend build holds the lock (or it cleared) — this build is a benign no-op"
    exit 0
  fi
fi
