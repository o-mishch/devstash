# shellcheck shell=bash
# Deep suspend / resume for the GCP deploy tooling. SOURCED by infra/run/gcp/run.sh (never
# executed) — it shares run.sh's shell scope, so the functions here rely on state the parent
# already established. Split out of run.sh purely to keep that orchestrator readable; this is
# organisational, not a standalone module. suspend/resume are the cross-cutting orchestrators:
# they call into db.sh, dns.sh AND the core steps that stay in run.sh, so this file MUST be
# sourced AFTER db.sh, dns.sh, and run.sh's core-step definitions (apply/eso/deploy/
# wait_for_cluster). Because bash resolves function names at call time, the only hard ordering
# requirement is that all of run.sh's globals + common.sh are defined before this is sourced.
#
# Depends on (provided by run.sh / db.sh / dns.sh in the shared scope):
#   globals   TF_DIR, PROJECT_ID, REGION, APP_DOMAIN
#   helpers   log/ok/warn/die (infra/lib/common.sh), tf_out, ensure_tfvars
#   run.sh core steps   apply, deploy, wait_for_cluster; ensure_operators (gke.sh)
#   db.sh    dump_db, restore_db
#   dns.sh   update_dns
#
# Source-guard: sourcing twice is a harmless no-op.
[[ -n "${_DEVSTASH_GCP_SUSPEND_SH:-}" ]] && return 0
_DEVSTASH_GCP_SUSPEND_SH=1

# The NEG/firewall reap loops are SHARED (identical logic, POSIX-sh) with the unattended Cloud Build
# cleanup step (scripts/auto-suspend-cleanup-negs.sh) via infra/lib/posix/reap-negs.sh — the ONE
# source of truth for both runtimes. bash sources POSIX sh transparently.
# shellcheck source=infra/lib/posix/reap-negs.sh
source "$(dirname "${BASH_SOURCE[0]}")/../../../lib/posix/reap-negs.sh"

# active.auto.tfvars is auto-loaded by OpenTofu (*.auto.tfvars) and is gitignored.
# Persisting the toggles here makes the suspended/active state STICKY: a plain
# `tofu apply` or `run.sh apply` keeps whatever state suspend/resume last set, instead
# of silently reverting to the defaults (active). suspend/resume write this file.
# $1 = environment_active (compute), $2 = db_active (Cloud SQL instance). Both lines are
# written together so they never drift out of sync.
set_active_state() {
  {
    printf 'environment_active = %s\n' "$1"
    printf 'db_active          = %s\n' "$2"
  } > "$TF_DIR/active.auto.tfvars"
}

# The Artifact Registry repo is destroyed by the suspend apply itself — modules/artifact-
# registry gates the repo on environment_active, and modules/iam gates its 3 repo-scoped IAM
# members on the same var, so when suspend() sets environment_active=false the plan destroys the
# repo + every image it holds through Terraform. No out-of-band `gcloud artifacts repositories
# delete` is needed. The members target the STATIC repo-id string, so a depends_on edge
# (modules/iam artifact_registry_repository_depends_on) is what forces them to destroy BEFORE the
# repo — without it they race the repo, 403 on the vanished repo (getIamPolicy/setIamPolicy on an
# absent resource returns 403), and abort the apply before the GKE destroy, stranding the cluster
# billing. reconcile.sh branch 4 heals any state a PRE-fix suspend already stranded. Resume flips
# the gate back on; the plan recreates the repo + members, then CI rebuilds + repushes before the
# app is deployed. Symmetric across both suspend paths.

# cleanup_builds: cancel any in-flight Cloud Builds and delete the ${project}_cloudbuild
# source-staging bucket so a deep-suspended env holds no lingering Cloud Build state/storage.
# Cloud Build has NO delete API for build RECORDS (Google expires them by retention), so the
# history list can't be emptied — cancelling in-flight work + reclaiming the staging bucket is
# the actionable cleanup. Build logs are left alone (whole-log delete only, which would wipe
# the auto-suspend failure-alert's ERROR counts). Mirrors the unattended auto-suspend step 6
# (scripts/auto-suspend-cleanup-builds.sh); keep the two in sync. Best-effort — the env is
# already at ~$0, so a miss must not abort the suspend. By this point apply()'s
# wait_for_no_autosuspend_build already drained any running auto-suspend build, so nothing this
# cancels is our own teardown.
cleanup_builds() {
  local ids
  # Scope to THIS env's auto-suspend trigger only (match by the stable TRIGGER_NAME
  # substitution). A bare `builds list --ongoing` would also catch — and cancel — an unrelated
  # in-flight `deploy-gke` run a teammate kicked off, or any other build in this shared project.
  # We only ever want to reap a stray auto-suspend build here; everything else must be left
  # running. _ongoing_autosuspend_build_ids (run.sh, sourced above this scope) single-sources
  # the trigger-name/filter contract shared with wait_for_no_autosuspend_build.
  ids="$(_ongoing_autosuspend_build_ids)"
  if [[ -n "$ids" ]]; then
    log "Cancelling in-flight auto-suspend Cloud Builds: ${ids//$'\n'/ }"
    # shellcheck disable=SC2086 # word-splitting is intended: one arg per build id.
    gcloud builds cancel $ids --region="$REGION" --project="$PROJECT_ID" --quiet \
      || warn "build cancel returned non-zero (some may have finished mid-cancel) — continuing"
  fi
  log "Deleting Cloud Build staging bucket gs://${PROJECT_ID}_cloudbuild"
  gcloud storage rm -r "gs://${PROJECT_ID}_cloudbuild" --quiet --project="$PROJECT_ID" \
    || warn "staging bucket delete returned non-zero (likely never created / already gone) — continuing"
}

# cleanup_leaked_negs: reap the zonal Network Endpoint Groups (and stray GKE firewall rules) that
# GKE leaks when a cluster is destroyed. GKE races its own teardown — the NEG controller is often
# shut down before it deletes the ingress's NEGs (one per Service-port per zone) — so on every deep
# suspend (a Terraform count→0 cluster destroy) some NEGs are orphaned. On suspend the VPC survives,
# so a leak blocks nothing yet; but the orphans ACCUMULATE across generations and, at the eventual
# `run.sh down`, each one pins the VPC delete. Reaping them here keeps the count bounded so `down`
# stays clean. VPC-scoped (network == devstash-<env>-vpc) so the project's `default` network and any
# unrelated resource are never touched. On the suspend/unattended paths the cluster is already gone
# when this runs, so every NEG still on our VPC is by definition a leaked orphan; on the `run.sh
# down` path it runs BEFORE the destroy (the NEGs must be reaped or they pin the VPC delete), so the
# cluster may still be live — an in-use NEG delete simply fails "resource in use" and is swallowed,
# and the cluster is torn down moments later regardless. Best-effort throughout — the env is already
# at ~$0, so a miss must not abort the suspend/down. Mirrors scripts/auto-suspend-cleanup-negs.sh
# (unattended path); keep the two in sync.
cleanup_leaked_negs() {
  local vpc="devstash-${ENVIRONMENT}-vpc"
  # Only bother if the VPC still exists — a completed `down` already removed it (nothing to reap).
  # This gate is caller-specific and stays here: the `down` path can reach this while the cluster
  # (and an in-use NEG) is still live, so it must not attempt the reap against an already-gone VPC.
  # The Cloud Build step (which runs AFTER the cluster is destroyed) needs no such guard.
  gcloud compute networks describe "$vpc" --project="$PROJECT_ID" >/dev/null 2>&1 || return 0
  # ds_reap_leaked_negs (infra/lib/posix/reap-negs.sh) — the SAME VPC-scoped NEG + gke-*/k8s-*
  # firewall reap the Cloud Build cleanup step runs, single-sourced. Best-effort inside (each delete
  # tolerates already-gone / in-use); progress goes to stderr.
  ds_reap_leaked_negs "$vpc" "$PROJECT_ID"
}

# suspend: drive the environment to true ~$0. DUMPS Cloud SQL to GCS and verifies the
# dump FIRST, then sets environment_active=false + db_active=false and applies — this
# destroys the GKE cluster, Memorystore, Cloud NAT, Cloud Armor, the ingress IP AND the
# Cloud SQL instance (no kept disk). The data lives only in the verified GCS dump; resume
# restores it. The dump-and-verify happens before any destroy, so a failed dump aborts the
# suspend with the instance fully intact.
suspend() {
  ensure_tfvars
  log "Deep-suspending environment → ~\$0 (compute + Cloud SQL DESTROYED; data kept in GCS dump)"
  warn "Cloud SQL is DUMPED to GCS and verified, then DESTROYED. 'resume' recreates + restores it."
  warn "DNS for $APP_DOMAIN will go stale until 'resume' (the ingress IP is released)."
  dump_db                       # export + verify BEFORE anything is destroyed — aborts on failure
  set_active_state false false  # compute off + Cloud SQL instance destroyed
  apply                         # plan → review → apply; the plan shows the destroys (incl. the AR repo, now gated on environment_active)
  cleanup_builds                # cancel in-flight builds + delete the _cloudbuild staging bucket — best-effort, off the destroy path
  cleanup_leaked_negs           # reap NEGs/firewall rules GKE orphaned on cluster destroy — bounds the count so 'down' stays clean
  ok "Suspended to ~\$0 (data safe in the GCS dump). Run 'resume' to bring it back."
}

# _restore_and_wait_cluster: overlap the DB restore with the control-plane readiness poll.
# The two are independent — `restore_db` imports the GCS dump straight into the freshly-created
# Cloud SQL instance (already RUNNABLE after apply), while `wait_for_cluster` polls the GKE
# control plane; neither reads the other's result, and nothing between here and `eso` needs the
# cluster before the restore or vice versa. Run serially they cost restore(~1-3 min) +
# cluster-wait(up to several min) back to back; overlapped they cost max() of the two, saving
# min() — typically 1-3 min per resume. Mirrors infra/ci/ensure-operators.sh's &/wait join.
#
# _restore_and_wire_cluster: three-way overlap on resume — the DB restore, the ESO install, and
# the Reloader install all run concurrently, joined once. All three are mutually independent:
# restore is a `gcloud sql import` (touches NO kubeconfig), and the two operator installs read the
# shared kubeconfig without switching context (see ensure_operators). Previously the restore
# overlapped only the control-plane poll, and eso()→reloader() then ran serially AFTER it; folding
# the operators in hides the whole restore (~1-3 min) under the longer operator install (~3-4 min
# on a cold cluster) instead of paying them back-to-back.
#
# ORDERING: background the restore first, FOREGROUND wait_for_cluster (the shared-scope poll that
# must not be subshelled — it uses run.sh helpers + prints progress, and its die-on-timeout must
# abort directly), THEN ensure_operators — which fetches cluster creds ONCE (use_cluster, in the
# parent — concurrent get-credentials would corrupt the kubeconfig) and backgrounds the two
# installs, joining the restore PID alongside them. restore_db may `die` in its backgrounded
# subshell (import failure); that only kills the subshell, so ensure_operators' join captures its
# non-zero status and re-raises — a failed restore still aborts resume (instance up but empty). A
# best-effort skip (no dump / fresh env) exits 0, a no-op join. Output is [restore]-prefixed so it
# stays attributable while it interleaves with the poll dots + the [eso]/[reloader] install lines.
_restore_and_wire_cluster() {
  { restore_db 2>&1 | sed -e 's/^/[restore] /'; exit "${PIPESTATUS[0]}"; } &
  local restore_pid=$!
  wait_for_cluster
  ensure_operators "$restore_pid"   # eso ‖ reloader ‖ (restore, joined) — see gke.sh
}

# resume: bring the environment back from a deep-suspended state. Recreates compute AND
# the Cloud SQL instance, RESTORES the DB from the latest GCS dump, reinstalls the
# in-cluster operators (ESO + Reloader, gone with the old cluster), redeploys the app, and
# re-points DNS at the new ingress IP. Skips bootstrap (project/billing/state/APIs persist
# across a suspend). The restore runs after apply (instance is RUNNABLE) and before deploy,
# so the app + migrate Job see the restored schema + data.
resume() {
  ensure_tfvars
  log "Resuming environment (recreate compute + Cloud SQL, restore the dump). Takes several minutes."
  set_active_state true true

  # Two entry states reach `resume`, distinguished by whether the tofu outputs `secrets` reads
  # already exist (_tf_outputs_present):
  #
  #   • post-SUSPEND (outputs PRESENT): suspend keeps the SAs/WIF/static vars, so every output is
  #     readable NOW, before apply. Take the FAST path — PRE-DISPATCH CI so the image build overlaps
  #     the ~10-min Cloud SQL + ~5-7-min control-plane provision (see the pre-dispatch rationale in
  #     run.sh:_predispatch_ci_build). This is the common on-demand-showcase case.
  #
  #   • post-DOWN / first-ever (outputs ABSENT): a full `down` destroyed everything → 0 outputs, so
  #     `secrets` CANNOT run yet (it would read an empty state and — before this gate — pushed the
  #     #26991 warning box to GitHub). Take the SERIAL path: apply FIRST to recreate the infra +
  #     repopulate outputs, THEN secrets, THEN dispatch the deploy. This loses only the pre-dispatch
  #     overlap on a path that is already a from-scratch multi-minute rebuild. `resume` thus handles
  #     both a suspended and a downed env instead of corrupting GitHub on the latter.
  if _tf_outputs_present; then
    # FAST path — outputs present (post-suspend). Pre-dispatch CI (secrets refresh → deploy
    # provision) so build-push overlaps apply, arm the cancel trap so an early exit reaps the
    # orphaned run. Both single-sourced in run.sh, shared with up()'s outputs-present branch.
    log "Tofu outputs present (suspended env) — pre-dispatching CI so its build overlaps apply"
    _predispatch_ci_build          # sets DEPLOY_RUN_ID; runs secrets (outputs readable now) + deploy provision
    _arm_ci_cancel_trap resume     # cancel the run if anything below dies before the handoff
    apply        # Cloud SQL (~10 min) + control plane build here, in parallel with CI's build-push
    # Three-way overlap: DB restore ‖ ESO install ‖ Reloader install, all joined once (see
    # _restore_and_wire_cluster). All must complete before deploy touches the cluster + DB.
    _restore_and_wire_cluster
    log "CI build+push has been running in parallel with apply; its cluster-gated deploy job proceeds now that the cluster + secrets are live"
  else
    # OVERLAP path — no outputs (post-down / first-ever). The build's ONLY auth prerequisites (WIF
    # provider + deployer SA) have no dependency on the ~10-min Cloud SQL create, so apply JUST
    # those first (_apply_ci_identity, ~1 min — run.sh), push secrets, and pre-dispatch the build
    # so it overlaps the full apply below — the same overlap the outputs-present branch gets. This
    # replaces the old strictly-serial "apply → secrets → deploy" that left the build waiting out
    # the whole rebuild. _apply_ci_identity applies a Cloud-SQL-free -target subgraph; the full
    # apply that follows carries no -target and reconciles the complete graph (incl. the DB/AR/
    # binauthz secret values omitted by the identity-only apply), so the final state is consistent.
    warn "No tofu outputs (downed / first-ever env) — applying WIF identity first so the build overlaps apply"
    _apply_ci_identity             # ~1 min: WIF provider + deployer SA now exist
    _predispatch_ci_build          # secrets (identity outputs readable now) → deploy provision; sets DEPLOY_RUN_ID
    _arm_ci_cancel_trap resume     # cancel the run if anything below dies before the handoff
    apply        # recreate the rest (Cloud SQL ~10 min + control plane), in parallel with CI's build-push
    # Three-way overlap: DB restore ‖ ESO install ‖ Reloader install, all joined once (see
    # _restore_and_wire_cluster). All must complete before deploy touches the cluster + DB.
    _restore_and_wire_cluster
  fi
  update_dns

  # Take ownership of the dispatched run and block on it (clears the cancel trap first, returns 1
  # on CI failure). Shared by both branches — see run.sh:_watch_ci_run.
  _watch_ci_run || return 1

  # TLS is served from the project-scoped Certificate Manager cert (envs/dev/certmanager.tf),
  # which is NOT destroyed on suspend — so on resume the Gateway serves a valid cert immediately,
  # with NO re-provisioning wait. The only resume delay is DNS propagation to the new ingress IP
  # (TTL 300s, re-pointed by update_dns above). This replaced the old ManagedCertificate CRD +
  # pre-shared-cert stopgap, which existed only because the cluster-scoped cert had to re-provision
  # (~60 min) on every resume.
  ok "HTTPS is live as soon as DNS propagates to the new IP — the Certificate Manager cert survived the suspend (no reprovision wait)."
}
