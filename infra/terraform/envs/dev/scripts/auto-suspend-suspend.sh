#!/bin/sh
# Cloud Build step 4 — SUSPEND (only if idle; see auto-suspend.tf). $_VAR values are Cloud Build
# substitutions mapped onto the step env — the `script` field doesn't expand them in content —
# so plain POSIX shell. Now that the verified dump exists, drive to ~$0: destroy
# compute AND the Cloud SQL instance (db_active=false). -refresh=false keeps the apply (and
# this SA's perms) scoped to just what these two vars change.
#
# Before the apply it runs the same stranded-AR-IAM reconcile (branch 4) that run.sh's
# reconcile_state runs on the laptop path, so the unattended suspend recovers from a pre-fix
# stranding instead of 403-wedging every tick — behaviourally matching `run.sh suspend`.
set -eu
[ -f /workspace/SUSPEND ] || { echo "not idle — skipping suspend"; exit 0; }
cd /workspace/repo/infra/terraform/envs/dev
tofu init -input=false -backend-config="bucket=$_STATE_BUCKET"

# RECONCILE (branch 4) — heal an ALREADY-STRANDED repo-scoped AR-IAM state before the apply, so
# the unattended path recovers from a pre-fix stranding exactly as run.sh's reconcile_state does
# on the laptop path (infra/run/gcp/lib/reconcile.sh branch 4). A suspend that ran BEFORE the
# destroy-order fix (modules/iam artifact_registry_repository_depends_on) destroyed the repo
# first, then 403'd removing these members via the now-vanished repo — leaving them in state
# pointing at a repo GCP no longer has. The apply below would retry the same repo-scoped
# setIamPolicy and 403 AGAIN, re-wedging every scheduled tick (and firing the failure alert),
# with NO way to recover unattended. They cannot be destroyed through the API (no repo to
# setIamPolicy on), so purge them from state; resume recreates them (environment_active=true
# recreates the repo + members). Idempotent: each `state rm` is guarded by an exact-address
# `state list` check (tofu state rm on an absent address exits non-zero), so once purged — or on
# a clean env that was never stranded — this is a no-op. ONLY when the repo is genuinely ABSENT
# in GCP (the exact stranded signature); if the repo exists these are legitimately managed.
# The three module addresses are SHARED with reconcile.sh branch 4 via the committed data file
# infra/lib/ar-iam-member-addresses.txt, read here from the /workspace/repo clone step 2 (prepare)
# made — so the byte-exact addresses can no longer drift between this POSIX-sh reconcile and the bash
# one. Only the surrounding logic legitimately differs per runtime (raw `tofu state` here vs.
# reconcile.sh's tofu_/_reconcile_in_state/die). Skip blank + `#`-comment lines.
if ! gcloud artifacts repositories describe devstash \
     --location="$_REGION" --project="$_PROJECT_ID" >/dev/null 2>&1; then
  while IFS= read -r _ar_addr; do
    case "$_ar_addr" in '' | \#*) continue ;; esac
    if tofu state list "$_ar_addr" 2>/dev/null | grep -qxF "$_ar_addr"; then
      echo "Reconcile: repo 'devstash' is gone but $_ar_addr is still in state (stranded by a pre-fix suspend) — removing from state so this apply is not re-wedged by a 403"
      tofu state rm -lock-timeout=120s "$_ar_addr"
    fi
  done < /workspace/repo/infra/lib/ar-iam-member-addresses.txt
fi

# -lock-timeout=120s: the guard (step 1) checked the state lock was free, but steps 2-4 (clone,
# secret fetch, dump) take minutes, during which a human `run.sh apply` could acquire the lock.
# Without a timeout tofu's default is fail-immediately (0s), wedging the suspend on a briefly-held
# lock (self-heals next scheduler tick, but leaves the env billing meanwhile). Waiting 120s
# mirrors the human side's symmetry (run.sh apply also uses -lock-timeout=120s) so whichever
# grabs the lock first, the other waits it out instead of erroring.
tofu apply -input=false -auto-approve -refresh=false -lock-timeout=120s \
  -var environment_active=false -var db_active=false
