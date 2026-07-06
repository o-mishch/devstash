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

# _resume_bringup <pre-apply-fn>: the CI-overlapped bring-up tail shared verbatim by resume's two
# branches — the ONLY thing that differs between them is the pre-apply staging step passed in
# ($1 = _apply_ar_push_target on the fast/outputs-present path, _apply_ci_identity on the overlap/
# post-down path). After that: pre-dispatch CI (secrets refresh → deploy provision; sets
# DEPLOY_RUN_ID), arm the cancel trap so an early exit reaps the orphaned run, then run the joined
# apply ‖ ESO ‖ Reloader ‖ restore driver. Everything must complete before deploy touches cluster+DB.
# Kept in resume's own shell (no subshell) so _arm_ci_cancel_trap's EXIT trap and the narration span
# both stay owned by resume — see the span/trap rationale in resume() below.
_resume_bringup() {
  local pre_apply_fn="$1"
  "$pre_apply_fn"                 # branch-specific staging apply (AR-only vs full WIF identity)
  _predispatch_ci_build          # sets DEPLOY_RUN_ID; runs secrets (outputs readable now) + deploy provision
  _arm_ci_cancel_trap resume     # cancel the run if anything below dies before the handoff
  # apply (Cloud SQL ~10 min + control plane) runs in parallel with CI's build-push AND, inside this
  # driver, with the ESO ‖ Reloader install (started the instant the control plane responds, mid-apply)
  # + the Cloud-SQL-gated DB restore. All joined once — see _apply_and_wire_cluster_overlapped.
  _apply_and_wire_cluster_overlapped
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
    # FAST path — outputs present (post-suspend). suspend keeps the SAs/WIF/static vars, so every
    # output is readable now; pre-dispatch CI so build-push overlaps apply (shared with up()'s
    # outputs-present branch). The pre-apply here is the two-target AR-only staging apply: the AR
    # repo + deployer repoAdmin binding are count=environment_active (destroyed on suspend), so
    # recreate JUST those (~1 min) BEFORE pre-dispatching, else the build reaches the registry before
    # the binding lands and burns minutes in build-push.sh's ds_ar_writable poll (seen to attempt
    # 29/40, past the step's 8m retry). Identity itself survives the suspend, so this is NOT the full
    # _apply_ci_identity the post-down branch needs.
    log "Tofu outputs present (suspended env) — pre-dispatching CI so its build overlaps apply"
    _resume_bringup _apply_ar_push_target
    log "CI build+push has been running in parallel with apply; its cluster-gated deploy job proceeds now that the cluster + secrets are live"
  else
    # OVERLAP path — no outputs (post-down / first-ever). The build's ONLY auth prerequisites (WIF
    # provider + deployer SA) have no dependency on the ~10-min Cloud SQL create, so the pre-apply
    # here is the full _apply_ci_identity (~1 min — a Cloud-SQL-free -target subgraph), then the same
    # overlap the outputs-present branch gets. This replaces the old strictly-serial "apply → secrets
    # → deploy" that left the build waiting out the whole rebuild. The full apply inside
    # _resume_bringup carries no -target and reconciles the complete graph (incl. the DB/AR/binauthz
    # secret values omitted by the identity-only apply), so the final state is consistent.
    warn "No tofu outputs (downed / first-ever env) — applying WIF identity first so the build overlaps apply"
    _resume_bringup _apply_ci_identity
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

# _reconcile_deletion_protection: correct Terraform-level deletion_protection drift on the three
# singletons _reconcile_adopt (reconcile.sh) may have imported (Cloud SQL, GKE, Valkey has none).
# WHY THIS EXISTS — live incident, 2026-07-06: `tofu import` records a resource's attributes AS
# THEY ARE ON THE PROVIDER SIDE (often defaulting deletion_protection=true), NOT as config says.
# Nothing reconciles that afterwards because `down` destroys with -refresh=false (by design — see
# the destroy call below), so an imported Cloud SQL instance kept deletion_protection=true in state
# indefinitely and `tofu destroy` refused it outright ("Set it to false to proceed with instance
# deletion"), even though modules/cloudsql/main.tf has hardcoded deletion_protection=false. GKE's
# google_container_cluster carries the same Terraform-level attribute (modules/gke/variables.tf) and
# is imported the same way, so it is checked too; Memorystore's google_memorystore_instance has no
# such attribute (only the API-level deletion_protection_enabled, always false in config) so nothing
# to check there.
#
# For each address: if it's in state AND its state-recorded deletion_protection is true, run a
# TARGETED apply (still config-driven, not raw state surgery) so config's false wins. Skipped
# entirely when the address is absent from state (nothing to correct) or already false (the common
# case for a resource this script itself created). Best-effort per resource: a failed correction
# warns and lets the real destroy below surface its own error, rather than aborting the teardown
# on this pre-check alone.
_reconcile_deletion_protection() {
  local addr state_val
  for addr in \
    module.cloudsql.google_sql_database_instance.postgres[0] \
    module.gke.google_container_cluster.primary[0]
  do
    # `state show` on an address absent from state fails (non-zero, empty stdout) — that failure
    # doubles as the "nothing to correct" skip, so no separate presence check is needed. (NOTE:
    # reconcile.sh's _reconcile_in_state helper is NOT usable here — it is defined INSIDE
    # reconcile_state()'s body, so it only exists in the shell once that function has actually run;
    # `down` never calls reconcile_state, so relying on it would fail with "command not found" on
    # a fresh `run.sh down` with no prior `up`/`resume` in the same process — exactly how this
    # bug was first hit.)
    # `|| true` on the bare `state show` is REQUIRED under this script's `set -euo pipefail`: an
    # absent address makes `state show` exit non-zero, and under pipefail that propagates through
    # the `| sed | head` pipeline and would abort the WHOLE down() — the same footgun reconcile.sh's
    # PSC-subnet-purpose read already documents and guards against the same way.
    state_val="$( { tofu_ state show "$addr" 2>/dev/null || true; } \
      | sed -nE 's/^[[:space:]]*deletion_protection[[:space:]]*=[[:space:]]*(true|false).*/\1/p' | head -1)"
    [[ "$state_val" == "true" ]] || continue
    warn "Reconcile: $addr has deletion_protection=true in state (config says false) — correcting before destroy"
    tofu_locked_ apply -auto-approve -refresh=false -target="$addr" \
      || warn "could not pre-correct deletion_protection on $addr — the destroy below may fail on it"
  done
}

# _psc_connections_still_attached: true iff <destroy-output> matches the specific GCP error a
# service_connection_policy destroy hits when the Memorystore instance it just tore down hasn't
# finished its OWN async detach of the PSC connections yet (observed live 2026-07-06: the instance
# destroy reported complete, but the policy delete still 400'd "still has 2 PSC Connections
# associated with it" for a few minutes afterwards — a GCP-side cleanup lag, not a real conflict).
_psc_connections_still_attached() {
  grep -qiE 'ServiceConnectionPolicy.*still has [0-9]+ PSC Connection' <<<"$1"
}

# _handle_psc_destroy_block <destroy-output>: interactive recovery for the error above. There is
# deliberately NO automatic retry and NO force-delete lever here:
#   - `gcloud network-connectivity service-connection-policies delete` has no --force flag (checked
#     directly against the installed gcloud's own --help — nothing to pass).
#   - Google's docs (Configure service connection policies) explicitly warn that the PSC endpoints/
#     forwarding-rules/addresses a policy tracks are OWNED by the managed service (Memorystore) and
#     must not be deleted directly — doing so risks orphaned networking state, not a clean teardown.
# So the only genuinely safe move is to wait for GCP's own async cleanup to catch up (confirmed
# live: unblocked itself within a few minutes with no gcloud action taken) and retry the SAME
# destroy call. This function only asks — it never silently loops — per the standing rule that a
# destructive teardown escalation must be a human decision, not a self-healing retry.
# Returns 0 if the caller should retry the destroy, 1 if it should give up and propagate failure.
_handle_psc_destroy_block() {
  warn "The Memorystore PSC service-connection-policy still shows attached connections — this is usually GCP's own async cleanup lag right after the Memorystore instance destroy, not a real conflict."
  warn "There is no safe force-delete here: gcloud has no --force flag for this resource, and GCP's own docs warn against deleting the underlying PSC forwarding-rules/addresses directly (they are owned by Memorystore's lifecycle, not yours — doing so risks orphaned networking state)."
  if confirm "Wait ~60s for GCP's cleanup to catch up, then retry the destroy?"; then
    log "Waiting 60s for GCP to detach the lingering PSC connections..."
    sleep 60
    return 0
  fi
  warn "NOT RECOMMENDED by GCP: manually deleting the specific consumer forwarding-rules/addresses the destroy plan listed (shown above, under 'psc_connections') may unblock this, but can orphan networking state Memorystore no longer knows to clean up."
  if confirm "Skip the safe wait and delete those forwarding-rules/addresses directly anyway?"; then
    warn "Not automated — the exact resource names are in the destroy output above (consumer_forwarding_rule / consumer_address)."
    warn "Delete each with: gcloud compute forwarding-rules delete <name> --region=$REGION --project=$PROJECT_ID"
    warn "                  gcloud compute addresses delete <name> --region=$REGION --project=$PROJECT_ID"
    confirm "Have you deleted them and want to retry the destroy now?" && return 0
  fi
  return 1
}

# _shelve_protected_secrets / _restore_protected_secrets: preserve app_config/ops_config across a
# full `down` WITHOUT `-exclude`. WHY NOT `-exclude` — confirmed live, 2026-07-06: passing 2+
# `-exclude` flags to `tofu destroy`/`plan -destroy` together makes OpenTofu 1.12.3 silently report
# "No changes. No objects need to be destroyed." for the ENTIRE plan, even though dozens of real
# resources (confirmed: GKE, the VPC, its subnet) are still live and destroyable — verified by
# re-running the SAME plan with exactly ONE `-exclude` (correct, scoped result) vs. two-or-more
# (empty). This means `down` had likely never actually destroyed anything on a run where 2+
# `-exclude` flags were reached, silently leaving the GKE cluster (and everything else) running.
# The workaround: remove the protected resources from STATE ONLY (their GCP objects are untouched —
# `state rm` never calls the provider) right before the real destroy, run destroy with ZERO
# `-exclude` flags (proven reliable), then `tofu import` them back into state afterward so a
# subsequent `up`/`resume` still manages them instead of re-creating (and colliding with) them.
# Their `lifecycle.prevent_destroy = true` is harmless here — destroy never sees them once they are
# out of state, so the guard never triggers.
#
# Addresses: app_config + its version + the app_access IAM-member live in module.iam; ops_config +
# its version are top-level in envs/dev (ops_config has no separate IAM-member resource). ops_config's
# version is count-gated ([0]) — see infra/terraform/envs/dev/dns.tf. These are the ONLY
# prevent_destroy resources in the env — keep this pair of functions in sync if that changes.
_PROTECTED_SECRET_ADDRS=(
  module.iam.google_secret_manager_secret.app_config
  module.iam.google_secret_manager_secret_version.app_config
  module.iam.google_secret_manager_secret_iam_member.app_access
  google_secret_manager_secret.ops_config
  "google_secret_manager_secret_version.ops_config[0]"
)

# _shelve_protected_secrets: `state rm` each address that is actually present (state rm errors on an
# absent address, so presence is checked the same guarded way _reconcile_deletion_protection does).
# Best-effort per address: a failed removal warns and lets the real destroy below surface its own
# prevent_destroy error for that one resource, rather than aborting the whole teardown on this
# pre-step alone.
_shelve_protected_secrets() {
  local addr
  for addr in "${_PROTECTED_SECRET_ADDRS[@]}"; do
    { tofu_ state show "$addr" >/dev/null 2>&1 || continue; }
    log "Shelving $addr out of state before destroy (GCP object untouched — state rm only)"
    tofu_locked_ state rm "$addr" \
      || warn "could not shelve $addr out of state — the destroy below may hit its prevent_destroy guard"
  done
}

# _reimport_or_warn <addr> <id> <label>: `tofu import <addr> <id>`, and on failure warn with the
# exact manual `tofu import` command reconstructed from the SAME addr+id — so the recovery hint can
# never drift from what was actually attempted (the hazard when the import and its warn were two
# hand-kept-in-sync copies of the address). Best-effort by contract: never dies — the caller
# (`_restore_protected_secrets`) restores Terraform bookkeeping for objects that are already safe on
# the GCP side, so a failed re-import is a warn-and-continue, not a teardown-aborting error.
_reimport_or_warn() {
  local addr="$1" id="$2" label="$3"
  tofu_locked_ import "$addr" "$id" \
    || warn "could not re-import $label — manual: tofu import $addr \"$id\""
}

# _restore_protected_secrets: re-import the two secret containers + their newest ENABLED version +
# app_config's IAM-member, so a subsequent `up`/`resume` manages them instead of re-creating (and
# colliding 409 with) them. Best-effort per resource — a failed re-import warns with the exact
# manual `tofu import` command rather than dying, since the GCP objects themselves are already safe
# (never touched by shelve or destroy); only Terraform's bookkeeping would be stale.
_restore_protected_secrets() {
  local app_config_id="devstash-app-config" ops_config_id="devstash-ops-config"
  local app_config_ver ops_config_ver app_sa
  # newest ENABLED version only — re-importing an arbitrary version could pull in a disabled one.
  # ds_newest_enabled_secret_version (posix/secrets.sh, sourced via common.sh) single-sources the
  # `--filter=state:ENABLED --sort-by=~createTime --limit=1` incantation AND the trailing `|| true`
  # that is REQUIRED under this script's `set -euo pipefail`: a secret that genuinely does not exist
  # yet (a first-ever `down` before any `up` ever ran, or one deleted out-of-band) makes `gcloud`
  # exit non-zero, and a bare assignment would trip `set -e` and kill the WHOLE script silently,
  # potentially after the real destroy already succeeded. The split declaration above keeps the
  # command-substitution off the `local` line so its exit status can't mask under `set -e`.
  app_config_ver="$(ds_newest_enabled_secret_version "$app_config_id" "$PROJECT_ID")"
  ops_config_ver="$(ds_newest_enabled_secret_version "$ops_config_id" "$PROJECT_ID")"

  log "Restoring app_config + ops_config into Terraform state (GCP objects were never touched)"
  _reimport_or_warn module.iam.google_secret_manager_secret.app_config \
    "$PROJECT_ID/$app_config_id" "the app_config secret"
  if [[ -n "$app_config_ver" ]]; then
    _reimport_or_warn module.iam.google_secret_manager_secret_version.app_config \
      "projects/$PROJECT_ID/secrets/$app_config_id/versions/$app_config_ver" "the app_config secret version"
  else
    warn "app_config has no ENABLED version to re-import (unexpected — check gcloud secrets versions list $app_config_id)"
  fi
  # app_access's member is deterministic from the app SA's email (module.iam's own naming).
  app_sa="$(tf_out app_service_account_email)"
  if [[ -n "$app_sa" ]]; then
    _reimport_or_warn module.iam.google_secret_manager_secret_iam_member.app_access \
      "projects/$PROJECT_ID/secrets/$app_config_id roles/secretmanager.secretAccessor serviceAccount:$app_sa" \
      "the app_access IAM binding"
  else
    warn "no app_service_account_email output yet (post-down, expected until the next apply) — app_access IAM-member re-import deferred to that apply"
  fi
  _reimport_or_warn google_secret_manager_secret.ops_config \
    "$PROJECT_ID/$ops_config_id" "the ops_config secret"
  if [[ -n "$ops_config_ver" ]]; then
    _reimport_or_warn 'google_secret_manager_secret_version.ops_config[0]' \
      "projects/$PROJECT_ID/secrets/$ops_config_id/versions/$ops_config_ver" "the ops_config secret version"
  else
    warn "ops_config has no ENABLED version to re-import (fine if Spaceship DNS creds were never configured)"
  fi
}

# _reap_stranded_router: delete an out-of-band Cloud Router (+ its NAT) `down` finds in GCP but NOT
# in Terraform state — blocks the VPC delete with "network resource is already being used by
# .../routers/<name>" otherwise. WHY THIS EXISTS — live incident, 2026-07-06: an earlier partial/
# interrupted teardown cycle destroyed the router+NAT THROUGH Terraform once, but a later apply
# re-created them (module.network's google_compute_router/google_compute_router_nat, both gated on
# compute_active) and a SUBSEQUENT teardown's state ended up without them tracked at all (state
# reflects a different point in that churn than GCP does) — so `down`'s destroy skipped them
# entirely and the VPC delete failed on a router Terraform no longer knew existed. Safe to
# force-delete unconditionally here: `down` runs this AFTER cleanup_leaked_negs and the real destroy
# has already torn down GKE/compute, so nothing still routes through it. Best-effort + existence-
# gated (a normal `down` with no drift has no router here at all — 404 is the common case, not an
# error) so this is a harmless no-op on the normal path.
_reap_stranded_router() {
  local router="devstash-${ENVIRONMENT}-router"
  gcloud compute routers describe "$router" --region="$REGION" --project="$PROJECT_ID" \
    >/dev/null 2>&1 || return 0
  warn "Reconcile: Cloud Router '$router' exists in GCP but is untracked in state — deleting it directly so the VPC delete isn't blocked"
  gcloud compute routers delete "$router" --region="$REGION" --project="$PROJECT_ID" --quiet \
    || warn "could not delete stranded router $router — the VPC destroy below may fail on it"
}

# _down_destroy_with_psc_retry: run the real `tofu destroy` (NO `-exclude` — see
# _shelve_protected_secrets' doc for why) in a bounded retry loop. The ONLY failure this retries is
# the Memorystore PSC service-connection-policy 400 "still has N PSC Connections associated with it"
# — GCP's async detach lagging a few minutes behind the Memorystore instance's own completed destroy
# (see _psc_connections_still_attached), and only after the operator confirms via
# _handle_psc_destroy_block (never a silent auto-retry of a destructive command). Every OTHER failure
# restores the shelved secrets into state (else a partial destroy leaves them permanently untracked)
# and `die`s — which exits the whole script, so the caller's post-destroy steps never run on failure,
# exactly as before this was extracted. Returns 0 only on a clean destroy.
_down_destroy_with_psc_retry() {
  local destroy_out destroy_rc attempt=0
  while :; do
    attempt=$((attempt + 1))
    destroy_rc=0
    destroy_out="$(tofu_locked_ destroy -auto-approve -refresh=false 2>&1)" || destroy_rc=$?
    printf '%s\n' "$destroy_out"
    [[ $destroy_rc -eq 0 ]] && return 0
    if _psc_connections_still_attached "$destroy_out" && _handle_psc_destroy_block "$destroy_out"; then
      log "Retrying the destroy (attempt $((attempt + 1)))..."
      continue
    fi
    # Restore the shelved secrets into state even on failure — otherwise a partial/aborted
    # destroy leaves them permanently untracked (GCP objects are fine; only Terraform's
    # bookkeeping would drift) until someone notices and re-imports by hand.
    _restore_protected_secrets
    die "tofu destroy failed — resolve the error above, then re-run 'down' (it is safe to re-run; already-destroyed resources are skipped)"
  done
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
# GKE and Cloud SQL are unprotected in CONFIG (they are torn down on every suspend cycle), but a
# singleton adopted via reconcile.sh's `_reconcile_adopt` (a prior apply that created it in GCP
# without persisting state) can still carry deletion_protection=true in STATE from the plain
# `tofu import` that adopted it — import records the provider's live value verbatim, not config's.
# _reconcile_deletion_protection corrects that drift right before the real destroy (see call below).
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
    # Correct any deletion_protection=true left in state by a reconcile-time import (see the
    # function doc above down()) BEFORE the real destroy — a targeted apply, not raw state surgery.
    _reconcile_deletion_protection
    # Shelve app_config/ops_config OUT of state (GCP objects untouched) so the real destroy below
    # can run with ZERO `-exclude` flags — see _shelve_protected_secrets' doc for why `-exclude`
    # itself is not safe to use here (a confirmed OpenTofu 1.12.3 bug: 2+ `-exclude` flags together
    # make the whole plan silently report "No changes", which is how GKE survived a `down` that
    # reported "destroyed" on 2026-07-06).
    _shelve_protected_secrets
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
    # catch-if-absent, move on.) State-only destroy is safe here precisely because down() removes
    # EVERYTHING left in state (the two secrets are already shelved OUT of state, above — there is
    # no partial-state risk to guard against).
    #
    # NO `-exclude` here — see _shelve_protected_secrets' doc above down(). The real destroy runs in
    # a bounded, operator-confirmed retry loop for the one known-transient PSC-detach lag; every other
    # failure restores the shelved secrets and dies. See _down_destroy_with_psc_retry.
    _down_destroy_with_psc_retry
    # A leftover Cloud Router+NAT untracked in state (an out-of-band artifact of an earlier
    # partial teardown cycle) blocks the VPC delete with "network resource is already being used
    # by .../routers/<name>" — reap it the same way cleanup_leaked_negs reaps leaked NEGs.
    _reap_stranded_router
    # Reclaim the PSA peering + range GCP holds past the ABANDONed connection (best-effort).
    force_release_psa
    # Re-import app_config/ops_config now that the rest of the environment is gone — restores
    # Terraform's bookkeeping for the two objects that were never actually touched.
    _restore_protected_secrets
    ok "destroyed. (State bucket gs://$STATE_BUCKET and the project are left intact. app_config/ops_config preserved.)"
  else
    die "aborted"
  fi
}
