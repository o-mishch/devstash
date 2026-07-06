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
#   globals   TF_DIR, PROJECT_ID, REGION, APP_DOMAIN, ENVIRONMENT, STATE_BUCKET
#   helpers   log/ok/warn/die/confirm (infra/lib/common.sh), tf_out, tofu_, ensure_tfvars
#   run.sh core steps   apply/_apply_plan/_apply_exec, deploy, wait_for_cluster
#   gke.sh    use_cluster/_soft
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
    # Split the newline-list into a real array so the ids expand as separate args WITHOUT relying on
    # unquoted word-splitting (each id passed once, one batch cancel call — same call as before).
    local -a id_args
    mapfile -t id_args <<< "$ids"
    gcloud builds cancel "${id_args[@]}" --region="$REGION" --project="$PROJECT_ID" --quiet \
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

# _apply_and_wire_cluster_overlapped: the resume bring-up core — overlap the ESO + Reloader install
# with the LONG TAIL of the apply itself (the Cloud SQL create, ~10 min). This is the on-demand-
# showcase hot path, so every minute of wall-clock counts.
#
# WHY THIS IS THE WIN: within one `apply` OpenTofu builds module.gke and module.cloudsql as
# INDEPENDENT DAG branches, so the GKE control plane is reachable ~5-7 min in WHILE Cloud SQL is
# still creating — apply just does not RETURN until both finish (~10 min). Previously the whole
# `apply` returned first and only THEN did the operators install, stacking their ~3-4 min serially on
# the tail. A second tofu apply cannot run concurrently (the state lock is a global mutex — see
# run.sh:apply's split comment), so the overlap is cluster-side work (kubectl/helm, no lock) against
# the ONE running apply, not two applies.
#
# HOW: background _apply_exec, then join it with a fail-fast wait (_join_fail_fast) so an apply
# failure aborts immediately. The DB restore runs SERIALLY after that join — it is gated on Cloud
# SQL being RUNNABLE (i.e. the apply finishing).
#
# NO local ESO/Reloader install here (removed 2026-07-06): resume() always pre-dispatches the
# deploy-gke CI job before calling this function, and that job's ensure-operators.sh always
# installs ESO + Reloader before its own apply-infra.sh. A local ensure_operators() call here
# raced the CI job's install against the SAME Helm release on the SAME cluster with no
# coordination between the two processes — one side hit Helm's "another operation (install/
# upgrade/rollback) is in progress" lock, the other saw the external-secrets namespace as
# NotFound (created-but-not-yet-visible). restore_db (below) only touches Cloud SQL via gcloud —
# it has no dependency on ESO/Reloader — so there is nothing local left for the operators to
# unblock; CI's apply-infra.sh is the only thing that needs the ESO CRDs, and CI installs them
# itself first.
#
# ORDERING (kubeconfig safety):
#   1. _apply_plan runs in the FOREGROUND — keeps the interactive plan-review gate (AUTO_APPROVE skips
#      it on the CI/UI path; a manual laptop resume still reviews the plan).
#   2. _apply_exec is backgrounded ([apply]-prefixed). It runs no kubectl, so no context race.
#   3. wait_for_cluster runs in the FOREGROUND (shared-scope poll: uses run.sh helpers, prints
#      progress, die-on-timeout must abort directly) — must not be subshelled.
#
# The provisioning marker still spans the ENTIRE apply: mark_provisioning fires in _apply_plan and
# clear_provisioning (after the IAM cooldown) at the tail of the backgrounded _apply_exec — so
# backgrounding the exec does not widen the auto-suspend race window.
#
# WHY devstash-app-config CANNOT BE FRONT-LOADED (a recurring question): resume pre-dispatches the
# deploy BEFORE this apply runs, and the deploy's ESO step needs an ENABLED app-config version. It is
# tempting to enable that version early — the way _apply_ar_push_target / _apply_ci_identity pull the
# AR repo + WIF identity forward with `-target` so the build has them at dispatch time. It does not
# work for app-config: the blob (google_secret_manager_secret_version.app_config, modules/iam) is
# computed from database-url/database-ca-cert (module.cloudsql, the ~10-min create this driver
# overlaps), redis-url/redis-ca-cert (module.memorystore), the app-SA HMAC key, and depends_on
# module.gke — i.e. it depends on the SLOWEST resources in the whole apply. A -target pull-forward
# would either fail on null Cloud SQL outputs or push an INCOMPLETE blob missing the infra keys (the
# same partial state wait-secrets-sync.sh already classifies as suspended/mid-resume). And writing it
# out-of-band from secrets() via `gcloud secrets versions add` would fork the write-only,
# Terraform-owned version into a second writer — reintroducing the version churn + destroyed-latest
# outage the write-only design fixed (see modules/iam/main.tf). So the enabled version INHERENTLY
# lands mid-apply, AFTER dispatch. The deploy does not race it because the CI enabled-version gate
# (infra/ci/check-secret-version.sh) blocks the ESO step until this apply enables it. Only the secret
# SHELL is guaranteed early (prevent_destroy, survives suspend); its CONTENTS must wait for the infra
# they describe.
_apply_and_wire_cluster_overlapped() {
  # Snapshot BEFORE apply runs: was Cloud SQL already there? A genuine post-suspend resume finds
  # nothing (dump_db._apply_plan/_exec below is what (re)creates the instance); resume re-run
  # against an env that's already up finds it already describable. restore_db uses this to refuse
  # importing the (older, by definition) GCS dump over an already-live database — see its header.
  local was_already_live=false
  resolve_dump_target 2>/dev/null && _sql_instance_exists "$DUMP_INSTANCE" && was_already_live=true || true

  stage "apply → applying (Cloud SQL ~10m + control plane), pre-dispatched CI build overlapping"
  _apply_plan                       # foreground: init → reconcile → plan → CONFIRM (review gate)
  _apply_exec                       # foreground: no local operator install left to overlap it with
  wait_for_cluster                  # control plane up ~5-7 min in, mid-apply
  stage "restore DB from GCS dump (Cloud SQL runnable now that apply finished)"
  restore_db "$was_already_live"    # serial: Cloud SQL is RUNNABLE now (apply finished)
                                    # A restore failure aborts resume via restore_db's own die + set -e
}

# resume: bring the environment back from a deep-suspended state. Recreates compute AND
# the Cloud SQL instance, RESTORES the DB from the latest GCS dump, reinstalls the
# in-cluster operators (ESO + Reloader, gone with the old cluster), redeploys the app, and
# re-points DNS at the new ingress IP. Skips bootstrap (project/billing/state/APIs persist
# across a suspend). The restore runs after apply (instance is RUNNABLE) and before deploy,
# so the app + migrate Job see the restored schema + data.
resume() {
  ensure_tfvars
  # Single upfront intent gate BEFORE anything happens — GCP mutation OR the narration span below.
  # resume front-loads a staging apply (_apply_ar_push_target / _apply_ci_identity) + a CI dispatch
  # to overlap the ~10-min Cloud SQL create; _confirm_bringup (run.sh) makes all of that wait for one
  # `y` and exports _BRINGUP_CONFIRMED=1 so the downstream _apply_plan does not prompt a second time.
  # It runs before begin_span so a decline (_confirm_bringup `die`s) has nothing to unwind.
  _confirm_bringup resume
  # Open a timed narration span with the stage TOTAL: from here every log/ok/warn carries
  # "HH:MM:SS +elapsed", and `stage` prints numbered "[stage N/6]" banners (the 6 lives here, not
  # on each call) so the overall position is always visible. `end_span` is called explicitly on the
  # two graceful returns below (success tail + CI-fail). It is NOT an EXIT trap on purpose: resume
  # arms the CI-cancel EXIT trap (_arm_ci_cancel_trap) and clears it in _watch_ci_run, so an
  # end_span EXIT trap would be clobbered by / clobber that one (see run.sh:641). On a `set -e`
  # death mid-flight the process exits, discarding the span state — so no restore is needed there.
  begin_span 6

  stage "Resume start — recreate compute + Cloud SQL, restore the dump. Takes several minutes."
  # Local gitignored tfvars write only (no GCP mutation) — the intent gate above already consented.
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
    # The AR repo + deployer repoAdmin binding are count=environment_active — destroyed on suspend,
    # so recreate JUST those (~1 min) BEFORE pre-dispatching, else the build reaches the registry
    # before the binding lands and burns minutes in build-push.sh's ds_ar_writable poll (seen to
    # attempt 29/40, past the step's 8m retry). Identity itself survives the suspend, so this is the
    # two-target AR-only pre-apply, not the full _apply_ci_identity the post-down branch needs.
    _apply_ar_push_target          # ~1 min: AR repo + push binding exist before the build is dispatched
    _predispatch_ci_build          # sets DEPLOY_RUN_ID; runs secrets (outputs readable now) + deploy provision
    _arm_ci_cancel_trap resume     # cancel the run if anything below dies before the handoff
    # apply (Cloud SQL ~10 min + control plane) runs in parallel with CI's build-push AND, inside
    # this driver, with the ESO ‖ Reloader install (started the instant the control plane responds,
    # mid-apply) + the Cloud-SQL-gated DB restore. All joined once — see
    # _apply_and_wire_cluster_overlapped. Everything must complete before deploy touches cluster + DB.
    _apply_and_wire_cluster_overlapped
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
    # apply (Cloud SQL ~10 min + control plane) runs in parallel with CI's build-push AND, inside
    # this driver, with the ESO ‖ Reloader install + the Cloud-SQL-gated DB restore, all joined once
    # (see _apply_and_wire_cluster_overlapped). All must complete before deploy touches cluster + DB.
    _apply_and_wire_cluster_overlapped
  fi
  stage "re-point DNS at the new ingress IP"
  update_dns

  # Take ownership of the dispatched run and block on it (clears the cancel trap first, returns 1
  # on CI failure). Shared by both branches — see run.sh:_watch_ci_run.
  stage "watching CI deploy run (build+push overlapped apply; the cluster-gated deploy proceeds now)"
  _watch_ci_run || { end_span; return 1; }

  # TLS is served from the project-scoped Certificate Manager cert (envs/dev/certmanager.tf),
  # which is NOT destroyed on suspend — so on resume the Gateway serves a valid cert immediately,
  # with NO re-provisioning wait. The only resume delay is DNS propagation to the new ingress IP
  # (TTL 300s, re-pointed by update_dns above). This replaced the old ManagedCertificate CRD +
  # pre-shared-cert stopgap, which existed only because the cluster-scoped cert had to re-provision
  # (~60 min) on every resume.
  ok "HTTPS is live as soon as DNS propagates to the new IP — the Certificate Manager cert survived the suspend (no reprovision wait)."
  end_span
}

# ── full teardown (down) ────────────────────────────────────────────────────
# `down` is the destructive counterpart to `suspend`: where suspend drives the env to ~$0 while
# PRESERVING the verified Cloud SQL dump for `resume`, down force-destroys everything (dump
# included). It lives here beside cleanup_leaked_negs/cleanup_builds — the rest of the teardown
# family it calls into — rather than in run.sh's orchestration body. empty_bucket + force_release_psa
# are its two private helpers (no other caller).

# empty_bucket <gs://bucket>: recursively delete every object (all versions) in a bucket so
# the no-force_destroy guard on google_storage_bucket does not block `tofu destroy`. Best-
# effort — an absent/already-empty bucket (or one destroyed earlier in the same run) must not
# abort the teardown. `--all-versions` reaches noncurrent generations too (both buckets have
# versioning on), otherwise archived versions keep the bucket non-empty and the delete fails.
empty_bucket() {
  local uri="$1"
  [[ -n "$uri" ]] || return 0
  gcloud storage buckets describe "$uri" --project="$PROJECT_ID" >/dev/null 2>&1 || return 0
  log "Emptying $uri (all object versions) so destroy can delete the bucket"
  gcloud storage rm -r --all-versions "$uri/**" --quiet --project="$PROJECT_ID" \
    || warn "empty of $uri returned non-zero (likely already empty) — continuing"
}

# force_release_psa: after `tofu destroy`, reclaim the leftover PSA plumbing GCP holds past the
# teardown. The service_networking_connection is ABANDONed on destroy (see modules/network) — it
# is dropped from state but the actual GCP peering + its reserved global address linger until
# GCP's producer lock clears (up to ~4 days after the last Cloud SQL instance died). Try to
# force them now so a `down` leaves the GCP side clean rather than trickling out over days.
# BOTH deletes are best-effort: the peering delete may still hit the producer lock (identical to
# the destroy path — nothing we can do but wait), and the address delete 409s until the peering
# releasing frees it. A miss here is not a teardown failure; it just means GCP finishes the job
# on its own schedule. Names are deterministic (modules/network name_prefix = devstash-<env>).
force_release_psa() {
  local vpc="devstash-${ENVIRONMENT}-vpc"
  local psa_range="devstash-${ENVIRONMENT}-psa"
  # Only attempt if the VPC still exists — a fully-completed destroy already removed it, and
  # then there is no peering to reap. `describe` is the existence probe; --project is explicit.
  gcloud compute networks describe "$vpc" --project="$PROJECT_ID" >/dev/null 2>&1 || return 0
  log "Force-releasing leftover PSA peering on $vpc (ABANDONed on destroy; GCP may still hold it)"
  gcloud services vpc-peerings delete --network="$vpc" \
    --service=servicenetworking.googleapis.com --project="$PROJECT_ID" --quiet \
    || warn "PSA peering delete returned non-zero (GCP producer lock not yet released — it clears on its own, up to ~4 days) — continuing"
  log "Releasing reserved PSA range $psa_range"
  gcloud compute addresses delete "$psa_range" --global --project="$PROJECT_ID" --quiet \
    || warn "PSA range delete returned non-zero (still held by the peering above) — continuing"
}

# down: FORCE-destroy the entire dev environment with `tofu destroy`.
# GKE and Cloud SQL are already unprotected in this env (they are torn down on every
# suspend cycle), so no deletion_protection dance is needed — destroy runs directly.
# Unlike `suspend` (which deliberately PRESERVES the verified Cloud SQL dump so `resume`
# can restore it), `down` is a full teardown: it EMPTIES the uploads + db-dumps buckets
# first so the no-force_destroy guard cannot block destroy, then force-releases the
# ABANDONed PSA peering + reserved range that GCP holds past the teardown. The state
# bucket and GCP project are left intact after destroy.
down() {
  ensure_tfvars
  # A fresh checkout has no initialized backend even when the state bucket exists.
  # Use the same explicit backend selection as apply so destroy cannot read local or
  # wrong-environment state by accident.
  tofu_ init -backend-config="bucket=$STATE_BUCKET"
  log "FORCE tear down — tofu destroy ($TF_DIR)"
  warn "This deletes the GKE cluster, Cloud SQL, and Memorystore."
  warn "UNLIKE 'suspend', 'down' also EMPTIES + DELETES the uploads AND db-dumps buckets —"
  warn "the last Cloud SQL dump is DESTROYED. There is no restore after a 'down'."
  warn "If you want a recoverable ~\$0 idle instead, use 'suspend' (keeps the dump)."
  if confirm "FORCE-destroy the entire dev environment (buckets + dump included)?"; then
    # Capture bucket names BEFORE destroy — the tofu outputs vanish once state is gone.
    # tf_out swallows a missing output (already-suspended/partial env) → empty, which
    # empty_bucket treats as a no-op.
    local uploads_uri db_dumps_uri
    uploads_uri="$(tf_out uploads_bucket)"; [[ -n "$uploads_uri" ]] && uploads_uri="gs://$uploads_uri"
    db_dumps_uri="$(tf_out db_dumps_bucket)"; [[ -n "$db_dumps_uri" ]] && db_dumps_uri="gs://$db_dumps_uri"
    empty_bucket "$uploads_uri"
    empty_bucket "$db_dumps_uri"
    # Reap GKE-leaked NEGs + firewall rules BEFORE destroy — they reference the VPC and would
    # otherwise fail its delete ("network resource is already being used by …/networkEndpointGroups/
    # …"). cleanup_leaked_negs (this file) is VPC-scoped and best-effort. This must run before
    # destroy, unlike the suspend path where it runs after (there the cluster destroy is a Terraform
    # apply, not a full VPC teardown, so the VPC survives and the NEGs only need reaping for later).
    cleanup_leaked_negs
    # The script already obtained explicit confirmation; avoid a second prompt that
    # makes AUTO_APPROVE=1 ineffective in automation.
    #
    # -refresh=false: destroy from state WITHOUT the pre-destroy refresh. `down` is a full
    # teardown, so we don't need to reconcile against live state first — and a resource the
    # env deleted out-of-band (e.g. the Artifact Registry repo + its repo-scoped IAM members,
    # which a deep-suspend destroys through Terraform / an older suspend deleted via gcloud)
    # would otherwise 403 during that refresh: GCP answers getIamPolicy on a vanished repo with
    # 403 (not 404), aborting the whole teardown before any destroy runs. Skipping the refresh
    # makes destroy operate on state alone — an already-gone resource just 404s on its own
    # delete call, which the provider tolerates, and the teardown proceeds. (Force-delete,
    # catch-if-absent, move on.) State-only destroy is safe here precisely because down()
    # removes EVERYTHING (bar the excluded secrets); there is no partial-state risk to guard against.
    #
    # -exclude the two Secret Manager secret CONTAINERS so a full `down` PRESERVES them (and,
    # by dependency, their versions + IAM grants — `-exclude` spares anything depending on the
    # excluded address). Both carry lifecycle.prevent_destroy = true, so WITHOUT these excludes
    # `tofu destroy` would ERROR ("Instance cannot be destroyed") and abort the whole teardown.
    # Rationale for keeping them: Secret Manager is ~$0 (inside the free version tier) and
    # re-entering the app + Spaceship-DNS creds by hand after every teardown is the real cost.
    # These are the ONLY prevent_destroy resources in the env — keep this list in sync if that
    # changes. Addresses: app_config lives in module.iam; ops_config is top-level in envs/dev.
    tofu_locked_ destroy -auto-approve -refresh=false \
      -exclude=module.iam.google_secret_manager_secret.app_config \
      -exclude=google_secret_manager_secret.ops_config
    # Reclaim the PSA peering + range GCP holds past the ABANDONed connection (best-effort).
    force_release_psa
    ok "destroyed. (State bucket gs://$STATE_BUCKET and the project are left intact.)"
  else
    die "aborted"
  fi
}
