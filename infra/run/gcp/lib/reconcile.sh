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

# ds_purge_stranded_ar_iam (branch 4 below) — the SHARED describe-gate + state-check + `tofu state rm`
# loop for stranded repo-scoped AR-IAM members, single-sourced with the unattended Cloud Build reconcile
# (scripts/auto-suspend-suspend.sh) via infra/lib/posix/reconcile-ar-iam.sh so the two can't drift.
# shellcheck source=infra/lib/posix/reconcile-ar-iam.sh
source "$(dirname "${BASH_SOURCE[0]}")/../../../lib/posix/reconcile-ar-iam.sh"

# ── Shared reconcile helpers (file scope) ──────────────────────────────────────────────────────
# Promoted OUT of reconcile_state's body so they (a) are defined once, not re-declared on every
# call, and (b) are reachable by other functions and by bats unit tests that source this file and
# drive them directly. They close over NO enclosing locals — everything is a positional arg or a
# run.sh global (TF_DIR/PROJECT_ID/…), exactly like the shared POSIX helper ds_purge_stranded_ar_iam.

# _reconcile_in_state <addr>: true iff <addr> is tracked in state. Filters by the exact address
# (authoritative — no whole-list grep) so an unrelated line can't fool it.
_reconcile_in_state() { tofu_ state list "$1" 2>/dev/null | grep -qxF "$1"; }

# _reconcile_tfvar <key>: echo the "true"/"false" value of a boolean toggle in active.auto.tfvars,
# or "" if absent. `|| true` + the split-declaration form at the call site are REQUIRED under
# `set -euo pipefail`: on a fresh/empty state the file may not exist yet, and a bare assignment
# whose pipeline returns non-zero would trip `set -e` and abort the whole run — the exact footgun
# that once silently killed `up` right after `tofu init` on a post-`down` empty state.
_reconcile_tfvar() {
  sed -nE "s/^[[:space:]]*$1[[:space:]]*=[[:space:]]*(true|false).*/\1/p" \
    "$TF_DIR/active.auto.tfvars" 2>/dev/null | head -1
}

# _reconcile_adopt <state-addr> <import-id> <label> [fatal] [quiet-import]: run the
# import → ok / already-managed-warn / (fatal ? die) sequence the DB, bucket, and quota
# branches all repeat verbatim. The import is idempotent: a stale/locked state read right
# after `init` could miss an address that import then reports as already-managed, so that
# outcome is treated as success (the "already managed — skipped" warn) and only a genuinely-
# still-absent address afterwards is fatal.
#   fatal        (default 1) — die if the import fails AND the address is still absent. Pass 0
#                for the quota case, where a genuinely-absent preference is a normal plan CREATE
#                (no 409), so a failed import is NOT fatal — only the create path decides.
#   quiet-import (default 0) — pass 1 to swallow the import's stderr (the quota case: its
#                describe/import can be noisy when the preference is simply absent).
# The per-resource PRESENCE check (each differs — a gcloud describe, or none for the quota) and
# the "why this resource is a singleton" rationale stay at each call site; only this uniform
# tail is shared. Mirrors the import tail of _reconcile_adopt_wif (which keeps its own
# undelete/poll-for-ACTIVE prelude and then falls through to this same shape).
_reconcile_adopt() {
  local addr="$1" import_id="$2" label="$3" fatal="${4:-1}" quiet="${5:-0}"
  log "Reconcile: importing $label into state (created by a prior apply that did not persist state)"
  local imported=1
  if [[ "$quiet" == 1 ]]; then
    tofu_ import -lock-timeout=120s "$addr" "$import_id" 2>/dev/null || imported=0
  else
    tofu_ import -lock-timeout=120s "$addr" "$import_id" || imported=0
  fi
  if [[ "$imported" == 1 ]]; then
    ok "$label adopted into state"
  elif _reconcile_in_state "$addr"; then
    warn "$label was already managed in state — import skipped"
  elif [[ "$fatal" == 1 ]]; then
    die "failed to import $addr — resolve manually, then re-run apply"
  fi
}

# _reconcile_choose <label> <destroy-note> -- <adopt-cmd...> :: <destroy-cmd...>: the SINGLE
# interactive gate every reconcile branch routes its "already exists / stranded" decision through,
# so the adopt-vs-reprovision behaviour is uniform across the whole file. It runs EXACTLY ONE of the
# two command vectors and never leaves the strand unhealed (an unhealed strand re-wedges the very
# apply this is trying to unblock — so the final fallback is ALWAYS the safe adopt).
#
#   <label>       human name of the resource, e.g. "Artifact Registry repo 'devstash'".
#   <destroy-note> a one-line note about the destroy option (empty "" to skip). Its meaning depends
#                 on whether destroy is possible (see the IMPOSSIBLE sentinel below):
#                   - destroy POSSIBLE  → a caution printed BEFORE the destroy prompt (e.g. "deletes
#                     all pushed images").
#                   - destroy IMPOSSIBLE → the reason it cannot work, printed instead of any prompt.
#   --            literal separator; the adopt command vector follows.
#   ::            literal separator; the destroy command vector follows. Pass the single literal
#                 token `IMPOSSIBLE` (instead of a command) when destroy CANNOT succeed even with
#                 extra steps (e.g. a soft-DELETED WIF name reserved for 30d) — the gate then never
#                 OFFERS destroy: it prints <destroy-note> and adopts. Offering a choice that can't
#                 succeed is worse than not offering it.
#
# Decision order (mirrors suspend.sh's _handle_psc_destroy_block: warn-context then confirm):
#   1. AUTO_APPROVE=1 (CI / Cloud Build / auto-suspend, no TTY) → run ADOPT immediately, NO prompt.
#      This preserves reconcile's self-healing contract that the unattended paths depend on; the
#      DESTROY vector must NEVER fire unattended. We check AUTO_APPROVE EXPLICITLY here rather than
#      letting confirm()'s implicit auto-yes carry it — the same safety precedent as run.sh's
#      state-lock release gate, where a dangerous action is gated on an explicit AUTO_APPROVE test.
#   2. destroy IMPOSSIBLE → warn <destroy-note> (why destroy can't work), then ADOPT. No prompt —
#      the user asked not to be offered an option that is impossible anyway.
#   3. Interactive TTY (destroy possible) → confirm "Adopt … and keep the existing resource?"
#        yes → ADOPT.
#        no  → print <destroy-note> (if any), then confirm "Destroy … and re-provision from config?"
#                yes → DESTROY (a subsequent plan recreates it from config).
#                no  → ADOPT (final safe fallback — never leave the strand).
#   4. No TTY and no AUTO_APPROVE → confirm returns 1 (declines the adopt question) → the destroy
#      question also declines → ADOPT. So a piped/non-tty invocation still self-heals safely.
_reconcile_choose() {
  local label="$1" destroy_note="$2"; shift 2
  [[ "$1" == "--" ]] || die "internal: _reconcile_choose expects -- before the adopt command"
  shift
  local adopt=() destroy=() seen_sep=0
  local tok
  for tok in "$@"; do
    if [[ "$seen_sep" == 0 && "$tok" == "::" ]]; then seen_sep=1; continue; fi
    if [[ "$seen_sep" == 0 ]]; then adopt+=("$tok"); else destroy+=("$tok"); fi
  done
  [[ "$seen_sep" == 1 ]] || die "internal: _reconcile_choose expects :: before the destroy command"

  # Unattended → always adopt (self-healing contract; destroy never fires without a human).
  if [[ "${AUTO_APPROVE:-}" == "1" ]]; then
    "${adopt[@]}"
    return
  fi

  # Destroy genuinely impossible → do not offer it; explain and adopt.
  if [[ "${destroy[0]:-}" == "IMPOSSIBLE" ]]; then
    warn "Reconcile: $label already exists in GCP but is not tracked in Terraform state."
    [[ -n "$destroy_note" ]] && warn "$destroy_note"
    "${adopt[@]}"
    return
  fi

  warn "Reconcile: $label already exists in GCP but is not tracked in Terraform state."
  if confirm "Adopt $label into state and keep the existing resource?"; then
    "${adopt[@]}"
    return
  fi
  [[ -n "$destroy_note" ]] && warn "$destroy_note"
  if confirm "Destroy $label in GCP and re-provision it from config instead?"; then
    "${destroy[@]}"
    return
  fi
  warn "Neither confirmed — defaulting to adopt so the strand is healed and the apply can proceed."
  "${adopt[@]}"
}

# _reconcile_wif_undelete_import <state-addr> <import-id> <describe-cmd...>: the ADOPT path for a WIF
# resource — if it reads DELETED, undelete + poll-for-ACTIVE first (undelete is async), then import.
# This is the command vector _reconcile_adopt_wif hands the choose-gate as "adopt".
_reconcile_wif_undelete_import() {
  local addr="$1" import_id="$2"; shift 2  # remaining args = the gcloud describe command
  local st; st="$("$@" --format='value(state)' 2>/dev/null || true)"
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
  # Shared import tail (import → ok / already-managed-warn / die) — the WIF-specific work is the
  # undelete + poll-for-ACTIVE prelude above; the adoption itself is the same as every other branch.
  _reconcile_adopt "$addr" "$import_id" "WIF resource '$import_id'"
}

# _reconcile_adopt_wif <state-addr> <import-id> <describe-cmd...>: gate one WIF resource (pool OR its
# provider) that is ABSENT from state but PRESENT in GCP. No-op when already in state or genuinely
# absent in GCP (describe empty). Otherwise routes through _reconcile_choose:
#   - soft-DELETED (the common strand) → destroy is IMPOSSIBLE: the name stays reserved ~30d, delete
#     cannot free it early, and a fresh create would 409 — so the gate does NOT offer destroy; it
#     explains why and adopts (undelete + import), the only path that actually works.
#   - ACTIVE-but-untracked (rare) → destroy IS possible (`gcloud … delete`), so both options are
#     offered; ADOPT = plain import.
# The describe verb is swapped to `undelete`/`delete` for the respective vectors. NOTE: undeleting
# the pool does NOT cascade to its provider — each is gated on its own.
_reconcile_adopt_wif() {
  local addr="$1" import_id="$2"; shift 2  # remaining args = the gcloud describe command
  _reconcile_in_state "$addr" && return 0
  local st; st="$("$@" --format='value(state)' 2>/dev/null || true)"
  [[ -z "$st" ]] && return 0  # not in GCP at all → let the plan CREATE it normally
  if [[ "$st" == "DELETED" ]]; then
    _reconcile_choose "WIF resource '$import_id'" \
      "It is soft-DELETED: the name stays reserved for ~30d and cannot be freed early, so destroy-and-re-provision is impossible (a fresh create would 409). Undeleting + adopting is the only path that works." \
      -- _reconcile_wif_undelete_import "$addr" "$import_id" "$@" \
      :: IMPOSSIBLE
    return
  fi
  local delete_cmd=("${@/describe/delete}")
  _reconcile_choose "WIF resource '$import_id'" \
    "Deleting a WIF pool/provider soft-deletes it — its name is then reserved ~30d, so it cannot be recreated until the reservation lapses. Adopt is strongly preferred." \
    -- _reconcile_adopt "$addr" "$import_id" "WIF resource '$import_id'" \
    :: "${delete_cmd[@]}" --quiet
}

# ── Per-branch reconcile steps (file scope; called in order by reconcile_state) ─────────────────

# _reconcile_db_database <db_active>: branch 1 — adopt an untracked-but-existing Cloud SQL database.
# The presence check filters state by the exact address (authoritative — no whole-list grep) so it
# can't be fooled by an unrelated line. The import is idempotent: a stale/locked state read right
# after `init` could miss an address that import then reports as already-managed, so treat that
# outcome as success and only fail if the address is genuinely still absent afterwards.
#
# ONLY when db_active=true (resume/apply-up). The devstash database resource is count-gated on
# instance_active (= db_active); during a suspend (db_active=false) its config is count→0, so an
# import target has no configuration and `tofu import` fails with "Configuration for import target
# does not exist" — blocking the very suspend that is meant to destroy the DB. A suspend WANTS the
# physical database gone, so there is nothing to adopt: skip the import.
_reconcile_db_database() {
  local db_active="$1"
  local db_addr='module.cloudsql.google_sql_database.devstash[0]'
  [[ "$db_active" != "false" ]] && ! _reconcile_in_state "$db_addr" || return 0
  local inst
  inst="$(tf_out db_instance_name)"
  if [[ -n "$inst" ]] && gcloud sql databases describe "$DB_NAME" \
       --instance="$inst" --project="$PROJECT_ID" >/dev/null 2>&1; then
    # Abandoned by a prior db-active toggle (the ABANDON deletion policy dropped it from state
    # without dropping the physical database). Ask adopt-vs-reprovision; destroy drops the physical
    # database (all rows) so a subsequent apply recreates it empty — run.sh then restores the dump.
    _reconcile_choose "Cloud SQL database '$DB_NAME'" \
      "Destroying the database drops ALL its rows — the next apply recreates it empty (run.sh restores the last GCS dump on resume)." \
      -- _reconcile_adopt "$db_addr" \
           "projects/$PROJECT_ID/instances/$inst/databases/$DB_NAME" \
           "Cloud SQL database '$DB_NAME'" \
      :: gcloud sql databases delete "$DB_NAME" --instance="$inst" \
           --project="$PROJECT_ID" --quiet
  fi
}

# _reconcile_psc_subnet: branch 2 — echo a "-replace=<addr>" target on stdout when the PSC subnet
# is tracked with the legacy purpose PRIVATE_SERVICE_CONNECT (immutable → cannot be patched), else
# nothing. Kept a PURE stdout emitter (the caller appends the result to RECONCILE_REPLACE) so it is
# trivially assertable in bats without touching the shared array. `|| true` in _reconcile_tfvar's
# sibling read below is the same set-e footgun guard the tfvar reads carry.
_reconcile_psc_subnet() {
  local subnet_addr='module.network.google_compute_subnetwork.psc'
  local purpose
  purpose="$( { tofu_ state show "$subnet_addr" 2>/dev/null || true; } \
    | sed -nE 's/^[[:space:]]*purpose[[:space:]]*=[[:space:]]*"([^"]+)".*/\1/p' | head -1)"
  if [[ "$purpose" == "PRIVATE_SERVICE_CONNECT" ]]; then
    warn "Reconcile: PSC subnet has legacy purpose PRIVATE_SERVICE_CONNECT — scheduling a replace with a PRIVATE subnet"
    printf '%s\n' "-replace=$subnet_addr"
  fi
}

# _reconcile_wait_sql_runnable <instance>: block until the Cloud SQL instance is RUNNABLE (up to
# ~10 min — create is slow), so a resume that races the prior apply's in-flight create does not
# import a PENDING_CREATE instance. Reuses poll_until (common.sh) + _sql_runnable (db.sh) instead
# of a hand-rolled `for _ in $(seq …)` loop; both resolve at call time (db.sh is sourced after this
# file but before reconcile_state ever runs).
_reconcile_wait_sql_runnable() {
  local sql_name="$1"
  _sql_runnable "$sql_name" && return 0
  warn "Reconcile: Cloud SQL '$sql_name' exists but is not RUNNABLE yet — waiting before import"
  poll_until 60 10 -- _sql_runnable "$sql_name" || true  # best-effort; adopt is attempted regardless
}

# _reconcile_adopt_sql_instance <state-addr> <instance-name>: the ADOPT command vector for the Cloud
# SQL instance branch — wait for RUNNABLE (so a resume racing an in-flight create doesn't import a
# PENDING_CREATE instance), then import. Single call so _reconcile_choose can run it as one vector.
_reconcile_adopt_sql_instance() {
  local sql_addr="$1" sql_name="$2"
  _reconcile_wait_sql_runnable "$sql_name"
  _reconcile_adopt "$sql_addr" "$PROJECT_ID/$sql_name" "Cloud SQL instance '$sql_name'"
}

# _reconcile_singletons <db_active> <env_active>: branch 3 — adopt untracked-but-existing GLOBALLY-
# UNIQUE / SINGLETON resources whose names cannot be reused if a prior apply created them in GCP but
# failed to persist state (a mid-apply crash, an aborted state write, or a state restore). A plain
# plan tries to CREATE them and dies with 409 "already exists" — and unlike an ordinary resource
# these have no alternate name to fall back to, so the apply is wedged until state matches reality.
# Each branch is self-disabling: once the address is in state, the presence check skips it. The
# import IDs follow each resource type's documented import form.
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
#   d. The three REGIONAL SINGLETONS a partial apply most often strands — the Cloud SQL
#      instance (devstash-<env>-pg), the GKE cluster (devstash-<env>-gke), and the Valkey
#      Memorystore instance (devstash-<env>-valkey). Each name is a per-(project,region)
#      singleton with no alternate to fall back to, so a create 409s exactly as observed when
#      CI created them but was cancelled before persisting state. All three are count-gated
#      (SQL on db_active, GKE+Valkey on environment_active), so like the DB-database branch
#      they are imported ONLY when their config exists (count=1) — otherwise the import target
#      has no configuration and `tofu import` errors. The SQL instance additionally may be
#      mid-creation (state PENDING_CREATE) when a resume races the prior apply's in-flight
#      create; importing then is racy, so it waits for RUNNABLE first (like WIF's poll-for-
#      ACTIVE prelude). Import forms per the provider docs:
#        SQL    "<project>/<name>"
#        GKE    "projects/<project>/locations/<region>/clusters/<name>"
#        Valkey "projects/<project>/locations/<region>/instances/<instance_id>"
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
_reconcile_singletons() {
  local db_active="$1" env_active="$2"

  local bucket_addr='google_storage_bucket.db_dumps'
  # Mirror Terraform's local.name_prefix = "devstash-<environment>" (locals.tf) so the bucket
  # name here is byte-identical to db-dumps.tf's "${project_id}-${name_prefix}-db-dumps".
  local bucket_name="${PROJECT_ID}-devstash-${ENVIRONMENT}-db-dumps"
  if ! _reconcile_in_state "$bucket_addr" \
     && gcloud storage buckets describe "gs://$bucket_name" --project="$PROJECT_ID" >/dev/null 2>&1; then
    _reconcile_choose "GCS bucket '$bucket_name'" \
      "Destroying the bucket deletes ALL its objects, including the last Cloud SQL dump — there is no restore after that." \
      -- _reconcile_adopt "$bucket_addr" "$PROJECT_ID/$bucket_name" "GCS bucket '$bucket_name'" \
      :: gcloud storage rm --recursive "gs://$bucket_name" --project="$PROJECT_ID" --quiet
  fi

  local quota_addr='google_cloud_quotas_quota_preference.compute_ssd_total_gb'
  local quota_id="compute-ssd-total-gb-${REGION}"
  local quota_name="projects/$PROJECT_ID/locations/global/quotaPreferences/$quota_id"
  # No gcloud presence check: the Cloud Quotas describe needs the `alpha` component (not always
  # installed). The import itself is the probe — it fails cleanly if the preference is absent,
  # and we only treat a genuinely-still-absent address afterwards as fatal.
  if ! _reconcile_in_state "$quota_addr"; then
    # Non-fatal + quiet import: a genuinely-absent preference ⇒ the plan CREATEs it normally
    # (no 409), so a failed import here is NOT fatal — only the create path decides; and the
    # describe/import is silenced because the Cloud Quotas describe needs the `alpha` component
    # (not always installed), so the probe is the import itself. "Destroy" for a quota preference
    # needs the `alpha` component and rarely applies (a stranded preference re-CREATEs cleanly, no
    # 409) — offered for uniformity, but adopt is almost always right.
    _reconcile_choose "quota preference '$quota_id'" \
      "Deleting a quota preference needs the gcloud 'alpha' component and is rarely necessary — a stranded preference re-creates cleanly on the next apply." \
      -- _reconcile_adopt "$quota_addr" "$quota_name" "quota preference '$quota_id'" 0 1 \
      :: gcloud alpha quotas preferences delete "$quota_id" \
           --service=compute.googleapis.com --project="$PROJECT_ID" --quiet
  fi

  # Cloud SQL instance. Gated on db_active. May be mid-creation (PENDING_CREATE) when a resume
  # races the prior apply's in-flight create — importing then is racy, so wait for RUNNABLE first.
  local sql_addr='module.cloudsql.google_sql_database_instance.postgres[0]'
  local sql_name="devstash-${ENVIRONMENT}-pg"
  if [[ "$db_active" != "false" ]] && ! _reconcile_in_state "$sql_addr"; then
    local sql_state
    sql_state="$(gcloud sql instances describe "$sql_name" --project="$PROJECT_ID" \
      --format='value(state)' 2>/dev/null || true)"
    if [[ -n "$sql_state" ]]; then
      _reconcile_choose "Cloud SQL instance '$sql_name'" \
        "Deleting the instance destroys the database and ALL its data — the next apply recreates an empty instance (run.sh restores the last GCS dump on resume)." \
        -- _reconcile_adopt_sql_instance "$sql_addr" "$sql_name" \
        :: gcloud sql instances delete "$sql_name" --project="$PROJECT_ID" --quiet
    fi
  fi

  # GKE cluster. Gated on environment_active (via cluster_active in main.tf).
  local gke_addr='module.gke.google_container_cluster.primary[0]'
  local gke_name="devstash-${ENVIRONMENT}-gke"
  if [[ "$env_active" != "false" ]] && ! _reconcile_in_state "$gke_addr" \
     && gcloud container clusters describe "$gke_name" --region="$REGION" \
          --project="$PROJECT_ID" >/dev/null 2>&1; then
    _reconcile_choose "GKE cluster '$gke_name'" \
      "Deleting the cluster tears down every running workload on it and takes several minutes to recreate." \
      -- _reconcile_adopt "$gke_addr" \
           "projects/$PROJECT_ID/locations/$REGION/clusters/$gke_name" \
           "GKE cluster '$gke_name'" \
      :: gcloud container clusters delete "$gke_name" --region="$REGION" \
           --project="$PROJECT_ID" --quiet
  fi

  # Valkey Memorystore instance. The whole module is count-gated on environment_active, so the
  # resource address carries the module index [0]. instance_id = "${name_prefix}-valkey".
  local valkey_addr='module.memorystore[0].google_memorystore_instance.cache'
  local valkey_name="devstash-${ENVIRONMENT}-valkey"
  if [[ "$env_active" != "false" ]] && ! _reconcile_in_state "$valkey_addr" \
     && gcloud memorystore instances describe "$valkey_name" --location="$REGION" \
          --project="$PROJECT_ID" >/dev/null 2>&1; then
    _reconcile_choose "Valkey instance '$valkey_name'" \
      "Deleting the cache instance drops all cached data (rebuilt on demand) and takes a few minutes to recreate." \
      -- _reconcile_adopt "$valkey_addr" \
           "projects/$PROJECT_ID/locations/$REGION/instances/$valkey_name" \
           "Valkey instance '$valkey_name'" \
      :: gcloud memorystore instances delete "$valkey_name" --location="$REGION" \
           --project="$PROJECT_ID" --quiet
  fi

  # Artifact Registry repo. Gated on environment_active (module.artifact_registry create=cluster
  # _active). Its repository_id ('devstash', per modules/artifact-registry local.repository_id) is
  # a per-(project,region) SINGLETON — a re-create can never pick another name, so a strand 409s
  # ("the repository already exists") exactly as observed when a prior teardown left the repo live
  # in GCP but dropped it from state (e.g. the -exclude-multiflag destroy that silently no-op'd, or
  # any partial suspend). Adopt it instead. This is the repo COUNTERPART to branch 4's IAM-member
  # PURGE: branch 4 drops stranded members when the repo is GONE; this adopts the repo when it is
  # PRESENT-but-untracked. The two never both fire (repo present XOR absent). Import form per the
  # provider docs: projects/<project>/locations/<region>/repositories/<repo_id>.
  local ar_repo_addr='module.artifact_registry.google_artifact_registry_repository.docker[0]'
  local ar_repo_name='devstash' # mirrors modules/artifact-registry local.repository_id
  if [[ "$env_active" != "false" ]] && ! _reconcile_in_state "$ar_repo_addr" \
     && gcloud artifacts repositories describe "$ar_repo_name" --location="$REGION" \
          --project="$PROJECT_ID" >/dev/null 2>&1; then
    _reconcile_choose "Artifact Registry repo '$ar_repo_name'" \
      "Deleting the repo permanently removes ALL images pushed to it — the next apply recreates it empty, so CI must rebuild + repush before a deploy can roll out." \
      -- _reconcile_adopt "$ar_repo_addr" \
           "projects/$PROJECT_ID/locations/$REGION/repositories/$ar_repo_name" \
           "Artifact Registry repo '$ar_repo_name'" \
      :: gcloud artifacts repositories delete "$ar_repo_name" --location="$REGION" \
           --project="$PROJECT_ID" --quiet
  fi

  local wif_pool_addr='module.iam.google_iam_workload_identity_pool.github'
  local wif_provider_addr='module.iam.google_iam_workload_identity_pool_provider.github'
  local wif_pool_id='github-actions'
  local wif_provider_id='github'
  local wif_pool_name="projects/$PROJECT_ID/locations/global/workloadIdentityPools/$wif_pool_id"
  # Pool first, then its child provider (the provider's import id nests under the pool).
  _reconcile_adopt_wif "$wif_pool_addr" "$wif_pool_name" \
    gcloud iam workload-identity-pools describe "$wif_pool_id" \
      --location=global --project="$PROJECT_ID"
  _reconcile_adopt_wif "$wif_provider_addr" "$wif_pool_name/providers/$wif_provider_id" \
    gcloud iam workload-identity-pools providers describe "$wif_provider_id" \
      --workload-identity-pool="$wif_pool_id" --location=global --project="$PROJECT_ID"
}

# _reconcile_purge_stranded_ar_iam: branch 4 — drop STRANDED repo-scoped AR IAM members from state.
# A suspend that ran BEFORE the destroy-order fix (modules/iam artifact_registry_repository_depends
# _on) destroyed the repo first, then 403'd trying to remove these members via the now-vanished repo
# — aborting the apply mid-teardown and leaving GKE billing. The members stay in state pointing at a
# repo GCP no longer has; the very next apply retries the same repo-scoped setIamPolicy and 403s
# again, re-wedging every apply/resume. They cannot be destroyed through the API (no repo to
# setIamPolicy on), so purge them from state: harmless because they are recreated on resume
# (environment_active=true recreates the repo, and modules/iam recreates the members gated on the
# same var).
#
# ONLY when the repo is genuinely ABSENT in GCP — the exact stranded-state signature. If the repo
# exists (normal active env) these are legitimately managed and must NOT be removed. Self-disabling:
# once purged (or on a clean env where they were never stranded) the state-list check finds nothing.
#
# Both the stranded-address DATA and the describe-gate + state-check + `state rm` LOOP are SHARED
# with the unattended auto-suspend's POSIX-sh reconcile (envs/dev/scripts/auto-suspend-suspend.sh):
# the addresses in infra/lib/ar-iam-member-addresses.txt, the loop in ds_purge_stranded_ar_iam
# (infra/lib/posix/reconcile-ar-iam.sh, sourced above). Single-sourcing BOTH is what keeps the two
# reconcilers from drifting. The helper runs raw `tofu` (both callers are already inside `tofu init`);
# here we escalate its non-zero return to `die` so a laptop apply stops loudly on a failed state-rm.
# _reconcile_run_purge_ar_iam <repo-id> <addr-file>: the ADOPT/heal command vector for the AR-IAM
# purge branch — runs the SHARED POSIX helper (single-sourced with the unattended Cloud Build
# reconcile) and escalates its non-zero to `die`. Kept a named wrapper so _reconcile_choose can run
# it as one adopt vector without pushing any prompt down into the shared, unattended-safe helper.
_reconcile_run_purge_ar_iam() {
  ds_purge_stranded_ar_iam "$1" "$REGION" "$PROJECT_ID" "$2" \
    || die "failed to purge stranded AR-IAM member(s) from state — resolve manually, then re-run apply"
}

_reconcile_purge_stranded_ar_iam() {
  local ar_repo_id='devstash' # mirrors modules/artifact-registry local.repository_id
  local ar_addrs_file; ar_addrs_file="$(dirname "${BASH_SOURCE[0]}")/../../../lib/ar-iam-member-addresses.txt"
  # A stranded member exists only when the repo is GONE in GCP AND at least one member address is
  # still tracked. Detect that here (mirroring the shared helper's own gate) so we only prompt when
  # there is real work — a clean env stays a silent no-op.
  gcloud artifacts repositories describe "$ar_repo_id" \
    --location="$REGION" --project="$PROJECT_ID" >/dev/null 2>&1 && return 0
  local stranded=0 addr
  while IFS= read -r addr; do
    case "$addr" in '' | \#*) continue ;; esac
    _reconcile_in_state "$addr" && { stranded=1; break; }
  done < "$ar_addrs_file"
  [[ "$stranded" == 1 ]] || return 0
  # Destroy is IMPOSSIBLE: the members cannot be removed through the API (no repo left to
  # setIamPolicy on) — purging the dangling STATE entry is the only heal, and re-provision happens
  # on the next apply (environment_active=true recreates the repo + members). So no destroy option.
  _reconcile_choose "stranded AR-IAM member(s) for repo '$ar_repo_id'" \
    "The repo is gone in GCP, so these members cannot be removed through the API — the only heal is to drop the dangling state entries; the next apply recreates the repo + members." \
    -- _reconcile_run_purge_ar_iam "$ar_repo_id" "$ar_addrs_file" \
    :: IMPOSSIBLE
}

# _reconcile_purge_stranded_sql: branch 5 — drop STRANDED Cloud SQL state entries when the instance
# is GONE in GCP. If the instance was deleted out-of-band (a partial/interrupted suspend, a manual
# `gcloud sql instances delete`, or a resume that died mid-teardown) but its state entries survive,
# EVERY subsequent plan's refresh reads them against the API, 404s ("The Cloud SQL instance does not
# exist"), and aborts before any work — wedging apply AND suspend alike (hit live 2026-07-06: GKE
# back up, SQL gone, every apply/suspend plan 404'd on google_sql_database/google_sql_user whose
# parent instance was absent). The database + app-user are COUNT-gated children of the instance;
# with the instance gone there is nothing to destroy through the API (deletion_policy=ABANDON on the
# database anyway), so purge all three from state. Harmless: resume (db_active=true) recreates the
# instance + database + user, then run.sh restores the GCS dump into it. Leaves (database, user) are
# removed BEFORE the instance, mirroring Terraform's own destroy order.
#
# ONLY when the instance is genuinely ABSENT in GCP — the exact stranded-state signature (an empty
# `gcloud sql instances describe`). On a normal active env the instance EXISTS, the describe returns
# a state, and these entries are legitimately managed and MUST NOT be removed. Self-disabling: once
# purged (or on a clean env) the state-list check below finds nothing. Distinct from branch 1/3d
# above, which ADOPT an untracked-but-EXISTING instance; this is the inverse — a TRACKED-but-GONE
# instance. The two never both fire (present XOR absent).
# _reconcile_run_purge_sql <instance-name>: the ADOPT/heal command vector for the SQL purge branch —
# state-rm the 3 stranded addresses (leaves→instance order, mirroring Terraform's destroy order).
# Named wrapper so _reconcile_choose can run it as one vector.
_reconcile_run_purge_sql() {
  local sql_purge_name="$1" sql_stranded_addr
  for sql_stranded_addr in \
    'module.cloudsql.google_sql_user.app[0]' \
    'module.cloudsql.google_sql_database.devstash[0]' \
    'module.cloudsql.google_sql_database_instance.postgres[0]'; do
    if _reconcile_in_state "$sql_stranded_addr"; then
      warn "Reconcile: Cloud SQL instance '$sql_purge_name' is absent in GCP but '$sql_stranded_addr' is still in state — purging the stranded entry"
      tofu_ state rm "$sql_stranded_addr" \
        || die "failed to purge stranded Cloud SQL entry '$sql_stranded_addr' from state — resolve manually, then re-run apply"
    fi
  done
}

_reconcile_purge_stranded_sql() {
  local sql_purge_name="devstash-${ENVIRONMENT}-pg"
  ! gcloud sql instances describe "$sql_purge_name" --project="$PROJECT_ID" \
      --format='value(state)' >/dev/null 2>&1 || return 0
  # Only prompt when there is real work — at least one of the 3 addresses still tracked.
  local stranded=0 addr
  for addr in \
    'module.cloudsql.google_sql_user.app[0]' \
    'module.cloudsql.google_sql_database.devstash[0]' \
    'module.cloudsql.google_sql_database_instance.postgres[0]'; do
    _reconcile_in_state "$addr" && { stranded=1; break; }
  done
  [[ "$stranded" == 1 ]] || return 0
  # Destroy is IMPOSSIBLE: the instance is already GONE in GCP (nothing to delete; the database
  # carries deletion_policy=ABANDON anyway) — dropping the dangling state entries is the only heal,
  # and resume recreates the instance + database + user, then restores the last GCS dump.
  _reconcile_choose "stranded Cloud SQL state entries for '$sql_purge_name'" \
    "The instance is already gone in GCP, so there is nothing to delete — the only heal is to drop the dangling state entries; resume recreates the instance + DB + user and restores the last dump." \
    -- _reconcile_run_purge_sql "$sql_purge_name" \
    :: IMPOSSIBLE
}

# reconcile_state: heal state↔cloud drift that a plain `tofu plan` cannot resolve, so a single
# `run.sh apply` is enough. A slim orchestrator over the per-branch functions above (each of which
# is self-disabling — once healed, subsequent applies are no-ops). Populates the RECONCILE_REPLACE
# array with any -replace targets for the caller to fold into `tofu plan`. MUST run AFTER `tofu init`
# (needs state). The two tfvar toggles gate the count-based resources: db_active gates the Cloud SQL
# database + instance; environment_active gates GKE/Valkey/AR. Both reads use the split-declaration
# + `_reconcile_tfvar` `|| true` guard (see that helper) so an absent/empty tfvars file can't trip
# `set -e`.
#
# NOTE — the AR repo + its 3 repo-scoped IAM members are gated on environment_active
# (modules/artifact-registry, modules/iam), so a deep-suspend destroys them THROUGH Terraform
# (state count→0). A depends_on edge (modules/iam artifact_registry_repository_depends_on) now
# forces the members to destroy BEFORE the repo, so a clean suspend no longer 403s. The AR-repo
# ADOPT (in _reconcile_singletons) and the branch-4 member PURGE are exact inverses (never both
# fire): adopt imports a repo PRESENT in GCP but untracked; purge drops stranded members when the
# repo is GONE.
reconcile_state() {
  RECONCILE_REPLACE=()
  local db_active env_active repl
  db_active="$(_reconcile_tfvar db_active)"
  env_active="$(_reconcile_tfvar environment_active)"

  _reconcile_db_database "$db_active"
  repl="$(_reconcile_psc_subnet)"
  [[ -n "$repl" ]] && RECONCILE_REPLACE+=("$repl")
  _reconcile_singletons "$db_active" "$env_active"
  _reconcile_purge_stranded_ar_iam
  _reconcile_purge_stranded_sql
}
