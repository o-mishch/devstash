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
  apply
  restore_db   # import the GCS dump into the fresh instance BEFORE the app deploys
  wait_for_cluster
  eso
  log "Redeploying the app (build → migrate → rollout) via CI"
  deploy
  update_dns
  log "Resume kicked off. Next:"
  echo "  1. Watch the deploy:  gh run watch"
  echo "  2. bash infra/run/gcp/run.sh smoke   # wait for CI + health check"
  warn "A new managed cert re-provisions after DNS resolves to the new IP (up to ~60 min)."
  warn "Site stays reachable meanwhile via the pre-shared-cert fallback (mcrt-ac492906-...) in overlays/gcp/kustomization.yaml."
}
