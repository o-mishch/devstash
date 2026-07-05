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
#   run.sh core steps   apply, eso, deploy, wait_for_cluster
#   db.sh    dump_db, restore_db
#   dns.sh   update_dns
#
# Source-guard: sourcing twice is a harmless no-op.
[[ -n "${_DEVSTASH_GCP_SUSPEND_SH:-}" ]] && return 0
_DEVSTASH_GCP_SUSPEND_SH=1

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

# delete_registry: delete the ENTIRE Artifact Registry repository (every image, version, tag,
# incl. :buildcache) so a deep-suspended env holds ZERO image storage AND no lingering repo —
# the last standing cost above the always-free tier. Safe: 'resume' runs a full-refresh apply
# that RECREATES the repo (TF-managed, ungated on environment_active), then CI rebuilds +
# repushes from source before the app is applied, and the Deployment pins images by the
# digest CI just produced. Best-effort — a delete miss (repo already gone) must not abort the
# suspend. Mirrors the unattended auto-suspend delete step
# (scripts/auto-suspend-delete-repo.sh); keep the two in sync.
delete_registry() {
  local repo
  # Prefer Terraform's own repository_id output (single source of truth — modules/artifact-
  # registry) so this never drifts from a repository_id rename. Fall back to the "devstash"
  # literal if the output isn't readable, e.g. state unavailable.
  repo="$(tf_out artifact_registry_url)"
  repo="${repo##*/}"                 # last path segment of region-docker.pkg.dev/project/repo
  [[ -n "$repo" ]] || repo="devstash"
  log "Deleting Artifact Registry repository ${repo} (all images + tags)"
  gcloud artifacts repositories delete "${repo}" \
    --location="$REGION" --quiet --project="$PROJECT_ID" \
    || warn "repository delete returned non-zero (likely already gone) — continuing"
}

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
  # substitution, as wait_for_no_autosuspend_build does). A bare `builds list --ongoing` would
  # also catch — and cancel — an unrelated in-flight `deploy-gke` run a teammate kicked off, or
  # any other build in this shared project. We only ever want to reap a stray auto-suspend
  # build here; everything else must be left running.
  local trigger="devstash-${ENVIRONMENT}-auto-suspend"
  ids="$(gcloud builds list --region="$REGION" --project="$PROJECT_ID" --ongoing \
           --filter="substitutions.TRIGGER_NAME=$trigger" \
           --format='value(id)' 2>/dev/null || true)"
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
  gcloud compute networks describe "$vpc" --project="$PROJECT_ID" >/dev/null 2>&1 || return 0
  log "Reaping leaked GKE NEGs on $vpc (orphaned by cluster teardown)"
  # Server-side --filter scoped to our VPC (self_link substring match via ':'); name + zone basename
  # per line so each delete gets its one name + zone. Read into a var first so a `list` hiccup
  # doesn't trip `set -e`. No matches → the loop body never runs → clean no-op.
  local negs
  negs="$(gcloud compute network-endpoint-groups list --project="$PROJECT_ID" \
            --filter="network:$vpc" --format='value(name,zone.basename())' 2>/dev/null || true)"
  if [[ -n "$negs" ]]; then
    local neg_name neg_zone
    while IFS=$'\t' read -r neg_name neg_zone; do
      [[ -n "$neg_name" ]] || continue
      gcloud compute network-endpoint-groups delete "$neg_name" --zone="$neg_zone" \
        --project="$PROJECT_ID" --quiet \
        || warn "NEG $neg_name delete returned non-zero (already gone / in use) — continuing"
    done <<< "$negs"
  fi
  # Stray GKE firewall rules leak by the same race and also block the VPC delete at `down`. Scoped
  # to our VPC AND the gke-/k8s- name prefix GKE uses, so only GKE's own auto-rules match — never a
  # hand-authored or Terraform-managed rule. Not TF-managed, so deleting them causes no state drift.
  local fw
  fw="$(gcloud compute firewall-rules list --project="$PROJECT_ID" \
          --filter="network:$vpc AND name:(gke-* OR k8s-*)" --format='value(name)' 2>/dev/null || true)"
  if [[ -n "$fw" ]]; then
    local fw_name
    while IFS= read -r fw_name; do
      [[ -n "$fw_name" ]] || continue
      gcloud compute firewall-rules delete "$fw_name" --project="$PROJECT_ID" --quiet \
        || warn "firewall $fw_name delete returned non-zero (already gone) — continuing"
    done <<< "$fw"
  fi
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
  apply                         # plan → review → apply; the plan shows the destroys
  delete_registry               # delete the AR repo (resume recreates it, CI rebuilds) — after apply, off the destroy path
  cleanup_builds                # cancel in-flight builds + delete the _cloudbuild staging bucket — best-effort, off the destroy path
  cleanup_leaked_negs           # reap NEGs/firewall rules GKE orphaned on cluster destroy — bounds the count so 'down' stays clean
  ok "Suspended to ~\$0 (data safe in the GCS dump). Run 'resume' to bring it back."
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

  # PARALLELIZE: the app image build depends on NONE of the GCP infra (it is pure
  # source→container), yet Cloud SQL alone takes ~10 min to create and the GKE control plane
  # another ~5-7 min. Dispatching CI NOW lets deploy-gke's `build-push` job (which needs only
  # `verify`, not the cluster — see .github/workflows/deploy-gke.yml) build + push to Artifact
  # Registry WHILE `apply` provisions the infra below. CI's cluster-gated `deploy` job then
  # waits for the cluster+secrets on its own. This overlaps the two slowest, independent phases
  # instead of running them back-to-back (~5-8 min off a resume).
  #
  # Pre-dispatch CI (secrets refresh → deploy provision) so build-push overlaps apply, then arm
  # the cancel trap so an early exit reaps the orphaned run. Both are single-sourced in run.sh
  # (_predispatch_ci_build / _arm_ci_cancel_trap), shared verbatim with up()'s CI-present branch —
  # `secrets` refreshes the WIF/DEPLOYER_SA GitHub secrets CI authenticates with (tofu outputs
  # persist across a suspend, so they are readable now), `deploy provision` tells CI's gate to build
  # despite no cluster yet, and the trap cancels the run on any non-zero exit before the handoff
  # below (apply's internal `die` means a plain `if ! apply` could never catch a failure). The watch
  # block below CLEARS the trap the instant it takes ownership (a successful resume must NOT cancel
  # the very run it is about to watch).
  _predispatch_ci_build          # sets DEPLOY_RUN_ID
  _arm_ci_cancel_trap resume     # cancel the run if anything below dies before the handoff

  apply        # Cloud SQL (~10 min) + control plane build here, in parallel with CI's build-push
  restore_db   # import the GCS dump into the fresh instance BEFORE the app deploys
  wait_for_cluster
  eso
  log "CI build+push has been running in parallel with apply; its cluster-gated deploy job proceeds now that the cluster + secrets are live"
  update_dns

  # Block on the dispatched run instead of firing-and-forgetting it: a resume that
  # merely kicks off CI and returns "done" hides a hung/failed build behind a
  # healthy-looking cluster (GKE shows ESO/Reloader up, but no devstash-web
  # Deployment until this run's rollout step completes). Surfacing pass/fail here,
  # in the same terminal invocation, replaces having to separately notice the gap
  # in the GCP console or run 'status'/'smoke' by hand.
  # Take ownership of the run: from here on a CI failure is surfaced by the watch below (not the
  # cancel trap). Clear the EXIT trap so a `return 1` on CI failure does NOT also cancel the run
  # we just watched fail — the watch already reported it, and cancelling a finished run is noise.
  trap - EXIT
  if [[ -n "${DEPLOY_RUN_ID:-}" ]]; then
    log "Watching deploy-gke run $DEPLOY_RUN_ID (build+push has its own retry/timeout — see deploy-gke.yml)"
    if gh run watch "$DEPLOY_RUN_ID" --exit-status; then
      ok "CI run $DEPLOY_RUN_ID completed successfully — devstash-web is rolled out"
      log "Next: bash infra/run/gcp/run.sh smoke   # health-check the live app"
    else
      warn "CI run $DEPLOY_RUN_ID FAILED — devstash-web is not deployed. Check: gh run view $DEPLOY_RUN_ID --log-failed"
      warn "Re-run the deploy once fixed:  bash infra/run/gcp/run.sh deploy"
      return 1
    fi
  else
    warn "could not confirm the dispatched run — follow it manually:  gh run watch"
  fi

  # TLS is served from the project-scoped Certificate Manager cert (envs/dev/certmanager.tf),
  # which is NOT destroyed on suspend — so on resume the Gateway serves a valid cert immediately,
  # with NO re-provisioning wait. The only resume delay is DNS propagation to the new ingress IP
  # (TTL 300s, re-pointed by update_dns above). This replaced the old ManagedCertificate CRD +
  # pre-shared-cert stopgap, which existed only because the cluster-scoped cert had to re-provision
  # (~60 min) on every resume.
  ok "HTTPS is live as soon as DNS propagates to the new IP — the Certificate Manager cert survived the suspend (no reprovision wait)."
}
