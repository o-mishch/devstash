# shellcheck shell=bash
# Terraform state↔cloud reconciliation for the GCP deploy tooling. SOURCED by infra/run/gcp/run.sh
# (never executed) — it shares run.sh's shell scope, so the functions here rely on state the parent
# already established. Split out of run.sh purely to keep that orchestrator readable; this is
# organisational, not a standalone module.
#
# Depends on (provided by run.sh before this file is sourced):
#   globals   TF_DIR, PROJECT_ID, REGION, ENVIRONMENT, DB_NAME
#   helpers   log/ok/warn/die (infra/lib/common.sh), tofu_, tf_out
# Sets (shared global, consumed by apply() in run.sh):
#   RECONCILE_REPLACE  (array of -replace= targets to fold into the plan)
#
# Source-guard: sourcing twice is a harmless no-op.
[[ -n "${_DEVSTASH_GCP_RECONCILE_SH:-}" ]] && return 0
_DEVSTASH_GCP_RECONCILE_SH=1

# reconcile_state: heal state↔cloud drift that a plain `tofu plan` cannot resolve, so a
# single `run.sh apply` is enough. Populates the RECONCILE_REPLACE array with any -replace
# targets for the caller to fold into `tofu plan`. MUST run AFTER `tofu init` (needs state).
# Both branches are self-disabling — once healed, subsequent applies are no-ops.
#
#   1. Cloud SQL `devstash` database present in the instance but ABSENT from state. The
#      ABANDON deletion policy (modules/cloudsql) drops the DB resource from state on a
#      db_active toggle WITHOUT dropping the physical database, so re-activating collides
#      with "database already exists". Import the existing database instead of recreating it.
#   2. The PSC subnet tracked with the legacy purpose PRIVATE_SERVICE_CONNECT. Memorystore
#      service-connectivity automation requires an ordinary PRIVATE subnet, and GCP cannot
#      PATCH a subnet's purpose in place — so the subnet must be REPLACED, not updated.
#
# NOTE — the AR repo + its 3 repo-scoped IAM members are gated on environment_active
# (modules/artifact-registry, modules/iam), so a deep-suspend destroys them THROUGH Terraform
# (state count→0). A depends_on edge (modules/iam artifact_registry_repository_depends_on) now
# forces the members to destroy BEFORE the repo, so a clean suspend no longer 403s. Branch 4
# below only heals the ALREADY-STRANDED state a PRE-fix suspend left behind: repo gone in GCP,
# members still in state. It is self-disabling — once the state is clean it is a no-op.
reconcile_state() {
  RECONCILE_REPLACE=()
  local db_addr='module.cloudsql.google_sql_database.devstash[0]'
  local subnet_addr='module.network.google_compute_subnetwork.psc'
  # _reconcile_in_state <addr>: true iff <addr> is tracked in state. Filters by the exact
  # address (authoritative — no whole-list grep) so an unrelated line can't fool it. Used by all
  # three reconcile branches below.
  _reconcile_in_state() { tofu_ state list "$1" 2>/dev/null | grep -qxF "$1"; }

  # 1. Adopt an untracked-but-existing Cloud SQL database. The presence check filters state
  # by the exact address (authoritative — no whole-list grep) so it can't be fooled by an
  # unrelated line. The import is idempotent: a stale/locked state read right after `init`
  # could miss an address that import then reports as already-managed, so treat that outcome
  # as success and only fail if the address is genuinely still absent afterwards.
  #
  # ONLY when db_active=true (resume/apply-up). The devstash database resource is count-gated
  # on instance_active (= db_active); during a suspend (db_active=false) its config is count→0,
  # so an import target has no configuration and `tofu import` fails with "Configuration for
  # import target does not exist" — blocking the very suspend that is meant to destroy the DB.
  # A suspend WANTS the physical database gone, so there is nothing to adopt: skip the import.
  local db_active
  db_active="$(sed -nE 's/^[[:space:]]*db_active[[:space:]]*=[[:space:]]*(true|false).*/\1/p' \
    "$TF_DIR/active.auto.tfvars" 2>/dev/null | head -1)"
  if [[ "$db_active" != "false" ]] && ! _reconcile_in_state "$db_addr"; then
    local inst
    inst="$(tf_out db_instance_name)"
    if [[ -n "$inst" ]] && gcloud sql databases describe "$DB_NAME" \
         --instance="$inst" --project="$PROJECT_ID" >/dev/null 2>&1; then
      log "Reconcile: importing existing Cloud SQL database '$DB_NAME' into state (abandoned by a prior db-active toggle)"
      if tofu_ import -lock-timeout=120s "$db_addr" \
           "projects/$PROJECT_ID/instances/$inst/databases/$DB_NAME"; then
        ok "database '$DB_NAME' adopted into state"
      elif _reconcile_in_state "$db_addr"; then
        warn "database '$DB_NAME' was already managed in state — import skipped"
      else
        die "failed to import $db_addr — resolve manually, then re-run apply"
      fi
    fi
  fi

  # 2. Force-replace a legacy-purpose PSC subnet (purpose is immutable → cannot be patched).
  # `|| true` is REQUIRED: on a fresh/empty state `tofu state show <addr>` exits non-zero
  # ("no resource … in state"), and under `pipefail` that non-zero propagates through the
  # `| sed | head` pipeline. A BARE assignment (`purpose=$(…)`, no `local` on the same line)
  # whose command substitution returns non-zero trips `set -e` and aborts the whole run —
  # which is exactly what silently killed `up` right after `tofu init` on a post-`down` empty
  # state. Absent subnet ⇒ empty purpose ⇒ branch skipped, which is the correct outcome.
  local purpose
  purpose="$( { tofu_ state show "$subnet_addr" 2>/dev/null || true; } \
    | sed -nE 's/^[[:space:]]*purpose[[:space:]]*=[[:space:]]*"([^"]+)".*/\1/p' | head -1)"
  if [[ "$purpose" == "PRIVATE_SERVICE_CONNECT" ]]; then
    warn "Reconcile: PSC subnet has legacy purpose PRIVATE_SERVICE_CONNECT — scheduling a replace with a PRIVATE subnet"
    RECONCILE_REPLACE+=("-replace=$subnet_addr")
  fi

  # 3. Adopt untracked-but-existing GLOBALLY-UNIQUE / SINGLETON resources whose names cannot
  # be reused if a prior apply created them in GCP but failed to persist state (a mid-apply
  # crash, an aborted state write, or a state restore). A plain plan tries to CREATE them and
  # dies with 409 "already exists" — and unlike an ordinary resource these have no alternate
  # name to fall back to, so the apply is wedged until state matches reality. Each branch is
  # self-disabling: once the address is in state, the presence check skips it. The import IDs
  # follow each resource type's documented import form.
  #
  #   a. GCS db-dumps bucket. Bucket names are GLOBAL; a re-create can never pick another name.
  #      Import form: "<project>/<bucket-name>". Name mirrors db-dumps.tf exactly.
  #   b. SSD_TOTAL_GB quota preference. One preference per (service, quota_id, region); the id
  #      is fixed (compute-ssd-total-gb-<region>), so a re-create collides. Import form is the
  #      full resource name projects/<p>/locations/global/quotaPreferences/<id>.
  #   c. GitHub WIF pool (+ its provider). Pool/provider IDs are fixed singletons. GCP SOFT-
  #      deletes them (a deep-suspend or manual cleanup leaves them in state DELETED for ~30d),
  #      and the name stays reserved the whole time — so a re-create 409s AND a plain import
  #      would adopt a DELETED resource that the ACTIVE config immediately wants to replace.
  #      Undelete first (idempotent; no-op if already ACTIVE), THEN import pool and provider.
  #
  #      The deployer-SA impersonation binding (modules/iam google_service_account_iam_member
  #      .github_wif — roles/iam.workloadIdentityUser for the pool's principalSet) is NOT adopted
  #      here: it is an ORDINARY (non-singleton) resource, so it needs no import. But note WHY it
  #      matters — undeleting/re-adopting the pool drops that binding from state, and until a full
  #      apply recreates it the deployer SA has NO policy binding, so CI's WIF token exchange fails
  #      at the FIRST gcloud call with `iam.serviceAccounts.getAccessToken denied` (a 403 that reads
  #      like an auth misconfig but is really just the missing binding). The plain plan/apply after
  #      this reconcile recreates it as a clean `+ create` — so a successful `run.sh apply` is the
  #      fix; do NOT hunt for a broken WIF provider or SA-role change when that 403 appears fresh
  #      after a suspend/resume or a pool re-adoption.
  local bucket_addr='google_storage_bucket.db_dumps'
  # Mirror Terraform's local.name_prefix = "devstash-<environment>" (locals.tf) so the bucket
  # name here is byte-identical to db-dumps.tf's "${project_id}-${name_prefix}-db-dumps".
  local bucket_name="${PROJECT_ID}-devstash-${ENVIRONMENT}-db-dumps"
  if ! _reconcile_in_state "$bucket_addr" \
     && gcloud storage buckets describe "gs://$bucket_name" --project="$PROJECT_ID" >/dev/null 2>&1; then
    log "Reconcile: importing existing GCS bucket '$bucket_name' into state (created by a prior apply that did not persist state)"
    if tofu_ import -lock-timeout=120s "$bucket_addr" "$PROJECT_ID/$bucket_name"; then
      ok "bucket '$bucket_name' adopted into state"
    elif _reconcile_in_state "$bucket_addr"; then
      warn "bucket '$bucket_name' was already managed in state — import skipped"
    else
      die "failed to import $bucket_addr — resolve manually, then re-run apply"
    fi
  fi

  local quota_addr='google_cloud_quotas_quota_preference.compute_ssd_total_gb'
  local quota_id="compute-ssd-total-gb-${REGION}"
  local quota_name="projects/$PROJECT_ID/locations/global/quotaPreferences/$quota_id"
  # No gcloud presence check: the Cloud Quotas describe needs the `alpha` component (not always
  # installed). The import itself is the probe — it fails cleanly if the preference is absent,
  # and we only treat a genuinely-still-absent address afterwards as fatal.
  if ! _reconcile_in_state "$quota_addr"; then
    log "Reconcile: importing quota preference '$quota_id' into state (created by a prior apply that did not persist state)"
    if tofu_ import -lock-timeout=120s "$quota_addr" "$quota_name" 2>/dev/null; then
      ok "quota preference '$quota_id' adopted into state"
    elif _reconcile_in_state "$quota_addr"; then
      warn "quota preference '$quota_id' was already managed in state — import skipped"
    fi
    # Genuinely absent in GCP ⇒ import fails and address stays untracked ⇒ the plan CREATEs it
    # normally (no 409). So a failed import here is NOT fatal — only the create path decides.
  fi

  local wif_pool_addr='module.iam.google_iam_workload_identity_pool.github'
  local wif_provider_addr='module.iam.google_iam_workload_identity_pool_provider.github'
  local wif_pool_id='github-actions'
  local wif_provider_id='github'
  local wif_pool_name="projects/$PROJECT_ID/locations/global/workloadIdentityPools/$wif_pool_id"
  # _reconcile_adopt_wif <state-addr> <import-id> <describe-cmd...>: adopt one WIF resource (pool
  # OR its provider) that is ABSENT from state but PRESENT in GCP. Both are soft-deletable
  # singletons with the SAME hazard: a deep-suspend/manual-cleanup leaves them state=DELETED for
  # ~30d while the name stays reserved, so a plain create 409s AND a plain import would adopt a
  # DELETED resource the ACTIVE config immediately wants to recreate. So: describe → if DELETED,
  # undelete and WAIT for ACTIVE (undelete is async — the resource reads DELETED for a beat after
  # the call returns) → import. No-op when already in state or genuinely absent in GCP (describe
  # empty). NOTE: undeleting the pool does NOT cascade to its provider — each must be undeleted on
  # its own.
  _reconcile_adopt_wif() {
    local addr="$1" import_id="$2"; shift 2  # remaining args = the gcloud describe command
    _reconcile_in_state "$addr" && return 0
    local st; st="$("$@" --format='value(state)' 2>/dev/null || true)"
    [[ -z "$st" ]] && return 0  # not in GCP at all → let the plan CREATE it normally
    if [[ "$st" == "DELETED" ]]; then
      warn "Reconcile: WIF resource '$import_id' is soft-DELETED but its name is still reserved — undeleting before import"
      # Same describe args, verb swapped to `undelete` (describe/undelete share the flag set).
      local undelete_cmd=("${@/describe/undelete}")
      "${undelete_cmd[@]}" >/dev/null 2>&1 \
        || die "failed to undelete WIF resource '$import_id' — resolve manually, then re-run apply"
      # Poll for ACTIVE up to ~60s (undelete is async). `_` = the loop var is a bounded
      # countdown only, never read in the body.
      local _
      for _ in $(seq 1 12); do
        [[ "$("$@" --format='value(state)' 2>/dev/null || true)" == "ACTIVE" ]] && break
        sleep 5
      done
    fi
    log "Reconcile: importing existing WIF resource '$import_id' into state (created by a prior apply that did not persist state)"
    if tofu_ import -lock-timeout=120s "$addr" "$import_id"; then
      ok "WIF resource '$import_id' adopted into state"
    elif ! _reconcile_in_state "$addr"; then
      die "failed to import $addr — resolve manually, then re-run apply"
    fi
  }
  # Pool first, then its child provider (the provider's import id nests under the pool).
  _reconcile_adopt_wif "$wif_pool_addr" "$wif_pool_name" \
    gcloud iam workload-identity-pools describe "$wif_pool_id" \
      --location=global --project="$PROJECT_ID"
  _reconcile_adopt_wif "$wif_provider_addr" "$wif_pool_name/providers/$wif_provider_id" \
    gcloud iam workload-identity-pools providers describe "$wif_provider_id" \
      --workload-identity-pool="$wif_pool_id" --location=global --project="$PROJECT_ID"

  # 4. Drop STRANDED repo-scoped AR IAM members from state. A suspend that ran BEFORE the
  # destroy-order fix (modules/iam artifact_registry_repository_depends_on) destroyed the repo
  # first, then 403'd trying to remove these members via the now-vanished repo — aborting the
  # apply mid-teardown and leaving GKE billing. The members stay in state pointing at a repo GCP
  # no longer has; the very next apply retries the same repo-scoped setIamPolicy and 403s again,
  # re-wedging every apply/resume. They cannot be destroyed through the API (no repo to setIamPolicy
  # on), so purge them from state: harmless because they are recreated on resume (environment_active
  # =true recreates the repo, and modules/iam recreates the members gated on the same var).
  #
  # ONLY when the repo is genuinely ABSENT in GCP — the exact stranded-state signature. If the repo
  # exists (normal active env) these are legitimately managed and must NOT be removed. Self-disabling:
  # once purged (or on a clean env where they were never stranded) the state-list check finds nothing.
  #
  # SIBLING: the unattended auto-suspend runs the same reconcile in POSIX sh before its apply
  # (envs/dev/scripts/auto-suspend-suspend.sh) — different execution model (Cloud Build container,
  # can't source this file), so if these addresses/logic change, change them there too.
  local ar_repo_id='devstash' # mirrors modules/artifact-registry local.repository_id
  if ! gcloud artifacts repositories describe "$ar_repo_id" \
       --location="$REGION" --project="$PROJECT_ID" >/dev/null 2>&1; then
    local ar_iam_addrs=(
      'module.iam.google_artifact_registry_repository_iam_member.node_artifact_registry_reader[0]'
      'module.iam.google_artifact_registry_repository_iam_member.custom_node_artifact_registry_reader[0]'
      'module.iam.google_artifact_registry_repository_iam_member.deployer_artifact_registry[0]'
    )
    local ar_addr
    for ar_addr in "${ar_iam_addrs[@]}"; do
      if _reconcile_in_state "$ar_addr"; then
        warn "Reconcile: repo '$ar_repo_id' is gone but $ar_addr is still in state (stranded by a pre-fix suspend) — removing from state so the next apply is not re-wedged by a 403"
        tofu_ state rm -lock-timeout=120s "$ar_addr" \
          || die "failed to state-rm $ar_addr — resolve manually, then re-run apply"
      fi
    done
  fi
}
