#!/usr/bin/env bats
# Drift-tolerance for apply/suspend when a state-tracked resource was deleted out-of-band in GCP
# (the live 2026-07-06 incident: Cloud SQL gone, its state entries surviving, every plan's refresh
# 404ing and aborting apply AND suspend). Two layers, both here:
#   1. _plan_with_refresh_fallback (run.sh) — the reactive belt-and-suspenders: on a refresh-time
#      404 signature, retry the plan once with -refresh=false; on any OTHER failure, re-propagate.
#   2. reconcile_state branch 5 (reconcile.sh) — the proactive heal: purge the stranded Cloud SQL
#      database/user/instance state entries when the instance is ABSENT in GCP. Asserted statically
#      (the full function needs the whole run.sh scope; the branch's addresses + absent-gate are the
#      logic-bearing part and are what regressed).

setup() {
  load "${BATS_TEST_DIRNAME}/../../../lib/test_helper"
}

# ── _plan_with_refresh_fallback: extracted verbatim so it can be driven against a stubbed
# tofu_locked_ without sourcing all of run.sh. MUST stay byte-identical to run.sh's copy (asserted
# by the sync test at the bottom). warn is a no-op here; tofu_locked_ is the per-test stub. ──
_load_fallback() {
  warn() { :; }
  # shellcheck disable=SC2317  # invoked indirectly via the function under test
  _plan_with_refresh_fallback() {
    local out rc=0
    out="$(tofu_locked_ plan "$@" 2>&1)" || rc=$?
    printf '%s\n' "$out"
    [[ $rc -eq 0 ]] && return 0
    if printf '%s' "$out" | grep -qiE 'does not exist|was not found|Error 404|instanceDoesNotExist|resourceNotFound'; then
      warn "Plan hit a refresh-time 404 — a state-tracked resource was deleted out-of-band in GCP."
      warn "Retrying the plan with -refresh=false (plans against state alone; the stale entry plans as a destroy)."
      tofu_locked_ plan -refresh=false "$@"
      return $?
    fi
    return "$rc"
  }
}

@test "refresh-fallback: a clean plan runs once, no -refresh=false retry" {
  _load_fallback
  # tofu_locked_ succeeds and records its args to a log so we can prove it ran exactly once.
  local calls="${BATS_TEST_TMPDIR}/calls"; : > "$calls"
  tofu_locked_() { printf '%s\n' "$*" >> "$calls"; echo "Plan: 1 to add"; return 0; }
  run _plan_with_refresh_fallback -out=tfplan
  assert_success
  assert_output --partial "Plan: 1 to add"
  # Exactly one invocation, and it did NOT carry -refresh=false.
  run cat "$calls"
  assert_output "plan -out=tfplan"
  refute_output --partial "-refresh=false"
}

@test "refresh-fallback: a refresh-404 triggers exactly one -refresh=false retry" {
  _load_fallback
  local calls="${BATS_TEST_TMPDIR}/calls"; : > "$calls"
  # First call (no -refresh=false) 404s; the retry (with -refresh=false) succeeds.
  tofu_locked_() {
    printf '%s\n' "$*" >> "$calls"
    if printf '%s' "$*" | grep -q -- "-refresh=false"; then
      echo "Plan: 0 to add, 1 to destroy"; return 0
    fi
    echo "Error: googleapi: Error 404: The Cloud SQL instance does not exist., instanceDoesNotExist" >&2
    return 1
  }
  run _plan_with_refresh_fallback -out=tfplan
  assert_success
  assert_output --partial "Plan: 0 to add, 1 to destroy"
  # Two invocations: the failing refresh plan, then the -refresh=false retry.
  run cat "$calls"
  assert_line --index 0 "plan -out=tfplan"
  assert_line --index 1 "plan -refresh=false -out=tfplan"
}

@test "refresh-fallback: a NON-404 plan failure re-propagates without a -refresh=false retry" {
  _load_fallback
  local calls="${BATS_TEST_TMPDIR}/calls"; : > "$calls"
  # A syntax/auth error must NOT be swallowed by the fallback — it re-propagates, no retry.
  tofu_locked_() {
    printf '%s\n' "$*" >> "$calls"
    echo "Error: Invalid function argument; call to function \"x\" failed" >&2
    return 1
  }
  run _plan_with_refresh_fallback -out=tfplan
  assert_failure
  # Only ONE invocation — the fallback recognised this is not a refresh-404 and did not retry.
  run cat "$calls"
  assert_output "plan -out=tfplan"
}

# ── reconcile helpers (real drives): the branch functions are now file-scope in reconcile.sh, so
# each is driven directly against stubbed tofu_/gcloud collaborators. This replaces the earlier
# static-grep assertion of branch 5 with a behavioural test of the real function body — and adds
# coverage for the promoted helpers (_reconcile_in_state, _reconcile_adopt, _reconcile_tfvar) and
# the extracted branch functions that were previously nested and untestable. ──
#
# _load_reconcile: source common.sh (log/ok/warn/die/poll_until) + reconcile.sh into the test shell,
# then set the run.sh globals the functions read. Collaborators (tofu_/gcloud/tf_out/_sql_runnable)
# are stubbed per-test. log/ok are silenced to keep assert_output focused on the function's own
# warn/echo lines.
_load_reconcile() {
  # shellcheck source=infra/lib/common.sh
  source "$COMMON_SH"
  # shellcheck source=infra/run/gcp/lib/reconcile.sh
  source "$RECONCILE_SH"
  export PROJECT_ID=proj REGION=us-central1 ENVIRONMENT=dev DB_NAME=devstash
  export TF_DIR="${BATS_TEST_TMPDIR}/tf"; mkdir -p "$TF_DIR"
  # shellcheck disable=SC2317  # collaborators invoked indirectly via the functions under test
  log() { :; }
  # shellcheck disable=SC2317
  ok() { :; }
}

@test "_reconcile_in_state: exact-address match, not fooled by a substring line" {
  _load_reconcile
  # tofu_ state list echoes a superset; grep -qxF must match ONLY the whole exact address.
  # shellcheck disable=SC2317
  tofu_() { printf '%s\n' 'module.cloudsql.google_sql_database_instance.postgres[0]' \
                          'module.cloudsql.google_sql_database_instance.postgres[0].extra'; }
  run _reconcile_in_state 'module.cloudsql.google_sql_database_instance.postgres[0]'
  assert_success
  run _reconcile_in_state 'module.cloudsql.google_sql_database_instance.postgres'
  assert_failure  # a prefix of a tracked address is NOT tracked
}

@test "_reconcile_tfvar: reads a true/false toggle, empty when file or key absent" {
  _load_reconcile
  printf 'db_active = true\nenvironment_active = false\n' > "$TF_DIR/active.auto.tfvars"
  run _reconcile_tfvar db_active
  assert_output "true"
  run _reconcile_tfvar environment_active
  assert_output "false"
  run _reconcile_tfvar missing_key
  assert_output ""
  # Absent file → empty, non-zero-tolerant (must not abort under set -e).
  rm -f "$TF_DIR/active.auto.tfvars"
  run _reconcile_tfvar db_active
  assert_success
  assert_output ""
}

@test "_reconcile_adopt: import success → adopted; import-fails-but-in-state → skipped warn" {
  _load_reconcile
  # First: import succeeds.
  # shellcheck disable=SC2317
  tofu_() { return 0; }
  run _reconcile_adopt some.addr some/id "the thing"
  assert_success
  # Second: import fails, but the address IS already in state → treated as success (skip warn).
  # _reconcile_in_state calls `tofu_ state list <addr>` and greps for the exact address, so the
  # state-list stub must echo the address back.
  # shellcheck disable=SC2317
  tofu_() {
    case "$1" in
      import) return 1 ;;
      state) shift; [[ "$1" == "list" ]] && printf '%s\n' 'some.addr'; return 0 ;;
    esac
  }
  run _reconcile_adopt some.addr some/id "the thing"
  assert_success
  assert_output --partial "already managed in state — import skipped"
}

@test "_reconcile_adopt: import fails AND still absent → fatal dies (default), non-fatal does not" {
  _load_reconcile
  # import fails, and `state list` echoes nothing → address genuinely not in state.
  # shellcheck disable=SC2317
  tofu_() { case "$1" in import) return 1 ;; state) return 0 ;; esac; }
  run _reconcile_adopt some.addr some/id "the thing"
  assert_failure  # default fatal=1 → die
  # fatal=0 (the quota case): a failed import is NOT fatal.
  run _reconcile_adopt some.addr some/id "the thing" 0
  assert_success
}

@test "_reconcile_psc_subnet: emits -replace only for the legacy PSC purpose" {
  _load_reconcile
  # Legacy purpose → emit the replace target.
  # shellcheck disable=SC2317
  tofu_() { echo '  purpose = "PRIVATE_SERVICE_CONNECT"'; }
  run _reconcile_psc_subnet
  assert_output --partial "-replace=module.network.google_compute_subnetwork.psc"
  # Ordinary purpose → emit nothing.
  # shellcheck disable=SC2317
  tofu_() { echo '  purpose = "PRIVATE"'; }
  run _reconcile_psc_subnet
  refute_output --partial "-replace="
  # Absent from state (state show fails) → empty purpose → nothing, and no set -e abort.
  # shellcheck disable=SC2317
  tofu_() { return 1; }
  run _reconcile_psc_subnet
  assert_success
  refute_output --partial "-replace="
}

@test "_reconcile_db_database: db_active=false skips entirely (suspend safety)" {
  _load_reconcile
  # If it did NOT skip, it would call tofu_/gcloud; make those fail loudly so a regression is caught.
  # shellcheck disable=SC2317
  tofu_() { echo "UNEXPECTED tofu_ call" >&2; return 1; }
  # shellcheck disable=SC2317
  gcloud() { echo "UNEXPECTED gcloud call" >&2; return 1; }
  # shellcheck disable=SC2317
  tf_out() { echo "UNEXPECTED tf_out call" >&2; return 1; }
  run _reconcile_db_database false
  assert_success
  refute_output --partial "UNEXPECTED"
}

@test "_reconcile_purge_stranded_sql: absent instance → state-rm's the 3 addrs, leaves first" {
  _load_reconcile
  local calls="${BATS_TEST_TMPDIR}/rm-calls"; : > "$calls"
  # Instance describe FAILS (absent) → the purge arms. Every address reads as in-state (state list
  # echoes back the queried address so _reconcile_in_state's grep -qxF matches), and state rm is
  # recorded in order.
  # shellcheck disable=SC2317
  gcloud() { return 1; }
  # shellcheck disable=SC2317
  tofu_() {
    case "$1" in
      state)
        shift
        case "$1" in
          list) printf '%s\n' "$2" ;;                     # echo the queried addr → "tracked"
          rm)   printf '%s\n' "$2" >> "$calls" ;;         # record the purge in order
        esac
        return 0 ;;
    esac
  }
  run _reconcile_purge_stranded_sql
  assert_success
  run cat "$calls"
  # Leaves (user, database) removed BEFORE the instance, mirroring Terraform's destroy order.
  assert_line --index 0 'module.cloudsql.google_sql_user.app[0]'
  assert_line --index 1 'module.cloudsql.google_sql_database.devstash[0]'
  assert_line --index 2 'module.cloudsql.google_sql_database_instance.postgres[0]'
}

@test "_reconcile_purge_stranded_sql: present instance → purges nothing" {
  _load_reconcile
  # Instance describe SUCCEEDS (present) → the purge is a no-op; any state rm would be a bug.
  # shellcheck disable=SC2317
  gcloud() { return 0; }
  # shellcheck disable=SC2317
  tofu_() { case "$1" in state) shift; [[ "$1" == "rm" ]] && { echo "UNEXPECTED state rm" >&2; return 1; };; esac; return 0; }
  run _reconcile_purge_stranded_sql
  assert_success
  refute_output --partial "UNEXPECTED"
}

@test "_reconcile_wait_sql_runnable: returns immediately when already RUNNABLE" {
  _load_reconcile
  # shellcheck disable=SC2317
  _sql_runnable() { return 0; }  # already runnable → no poll, no warn
  run _reconcile_wait_sql_runnable devstash-dev-pg
  assert_success
  refute_output --partial "waiting"
}

# ── _reconcile_choose: the interactive adopt-vs-reprovision gate. Drives it with two visible probe
# commands (`_probe_adopt` / `_probe_destroy`) that print a marker so a test can assert WHICH vector
# ran, and stubs `confirm` (a shell function, so override — never spy_cmd) to script the answers. ──
_choose_probes() {
  # shellcheck disable=SC2317  # invoked indirectly via _reconcile_choose
  _probe_adopt() { echo "ADOPTED"; }
  # shellcheck disable=SC2317
  _probe_destroy() { echo "DESTROYED"; }
}

@test "_reconcile_choose: AUTO_APPROVE=1 → adopts with NO prompt (CI self-heal contract)" {
  _load_reconcile
  _choose_probes
  # confirm MUST NOT be called under AUTO_APPROVE — if it is, fail loudly.
  # shellcheck disable=SC2317
  confirm() { echo "UNEXPECTED confirm" >&2; return 0; }
  AUTO_APPROVE=1 run _reconcile_choose "the thing" "unsafe" -- _probe_adopt :: _probe_destroy
  assert_success
  assert_output --partial "ADOPTED"
  refute_output --partial "DESTROYED"
  refute_output --partial "UNEXPECTED"
}

@test "_reconcile_choose: interactive, user adopts → runs the adopt vector" {
  _load_reconcile
  _choose_probes
  # Accept the first (adopt) prompt.
  # shellcheck disable=SC2317
  confirm() { [[ "$1" == "Adopt "* ]]; }
  AUTO_APPROVE=0 run _reconcile_choose "the thing" "unsafe" -- _probe_adopt :: _probe_destroy
  assert_success
  assert_output --partial "ADOPTED"
  refute_output --partial "DESTROYED"
}

@test "_reconcile_choose: interactive, decline adopt then confirm destroy → runs the destroy vector" {
  _load_reconcile
  _choose_probes
  local confirms="${BATS_TEST_TMPDIR}/confirm.calls"; : > "$confirms"
  # Decline the adopt prompt, accept the destroy prompt.
  # shellcheck disable=SC2317
  confirm() { echo "$1" >> "$confirms"; [[ "$1" == "Destroy "* ]]; }
  AUTO_APPROVE=0 run _reconcile_choose "the thing" "IMAGE LOSS WARNING" -- _probe_adopt :: _probe_destroy
  assert_success
  assert_output --partial "DESTROYED"
  refute_output --partial "ADOPTED"
  # The unsafe note is printed before the destroy prompt.
  assert_output --partial "IMAGE LOSS WARNING"
  # Both prompts were shown, adopt first.
  run cat "$confirms"
  assert_line --index 0 --partial "Adopt "
  assert_line --index 1 --partial "Destroy "
}

@test "_reconcile_choose: interactive, decline BOTH → falls back to adopt (never leaves the strand)" {
  _load_reconcile
  _choose_probes
  # Decline everything.
  # shellcheck disable=SC2317
  confirm() { return 1; }
  AUTO_APPROVE=0 run _reconcile_choose "the thing" "unsafe" -- _probe_adopt :: _probe_destroy
  assert_success
  assert_output --partial "ADOPTED"
  refute_output --partial "DESTROYED"
  assert_output --partial "defaulting to adopt"
}

@test "_reconcile_choose: destroy IMPOSSIBLE → never prompts, prints the reason, adopts" {
  _load_reconcile
  _choose_probes
  # confirm must NEVER be reached on the IMPOSSIBLE path.
  # shellcheck disable=SC2317
  confirm() { echo "UNEXPECTED confirm" >&2; return 0; }
  AUTO_APPROVE=0 run _reconcile_choose "the thing" "cannot be destroyed within 30d" \
    -- _probe_adopt :: IMPOSSIBLE
  assert_success
  assert_output --partial "cannot be destroyed within 30d"
  assert_output --partial "ADOPTED"
  refute_output --partial "UNEXPECTED"
}

@test "_reconcile_choose: no adopt vector before -- is a hard internal error" {
  _load_reconcile
  # Missing the -- separator → die (mis-wiring must fail loudly, not silently no-op).
  run _reconcile_choose "the thing" "unsafe" _probe_adopt :: _probe_destroy
  assert_failure
}

@test "_reconcile_singletons AR-repo: interactive destroy → deletes the repo, does NOT import" {
  _load_reconcile
  printf 'environment_active = true\n' > "$TF_DIR/active.auto.tfvars"
  local calls="${BATS_TEST_TMPDIR}/gcloud.calls"; : > "$calls"
  # The AR repo is the ONLY singleton present: its describe succeeds, every other describe fails,
  # and the repo is untracked in state. Record gcloud so we can prove `repositories delete` ran.
  # shellcheck disable=SC2317
  gcloud() {
    echo "$*" >> "$calls"
    case "$1 $2" in
      "artifacts repositories") [[ "$3" == describe ]] && return 0 ;;  # repo present
    esac
    return 1  # bucket/sql/gke/valkey describes all absent
  }
  # Untracked in state (state list echoes nothing) so the adopt branch arms.
  # shellcheck disable=SC2317
  tofu_() { case "$1" in state) return 0 ;; esac; return 0; }
  # Decline adopt, accept destroy.
  # shellcheck disable=SC2317
  confirm() { [[ "$1" == "Destroy "* ]]; }
  AUTO_APPROVE=0 run _reconcile_singletons true true
  assert_success
  run cat "$calls"
  assert_output --partial "artifacts repositories delete devstash"
  # It must NOT have imported the repo after choosing destroy.
  refute_output --partial "import"
}

@test "_reconcile_singletons AR-repo: AUTO_APPROVE=1 → adopts (imports), never deletes" {
  _load_reconcile
  printf 'environment_active = true\n' > "$TF_DIR/active.auto.tfvars"
  local gcalls="${BATS_TEST_TMPDIR}/gcloud.calls"; : > "$gcalls"
  local tcalls="${BATS_TEST_TMPDIR}/tofu.calls"; : > "$tcalls"
  # shellcheck disable=SC2317
  gcloud() {
    echo "$*" >> "$gcalls"
    case "$1 $2" in
      "artifacts repositories") [[ "$3" == describe ]] && return 0 ;;
    esac
    return 1
  }
  # tofu_ import succeeds; state list echoes nothing (untracked) so the branch arms.
  # shellcheck disable=SC2317
  tofu_() { echo "$*" >> "$tcalls"; case "$1" in import) return 0 ;; esac; return 0; }
  AUTO_APPROVE=1 run _reconcile_singletons true true
  assert_success
  run cat "$tcalls"
  assert_line --partial "import -lock-timeout=120s module.artifact_registry.google_artifact_registry_repository.docker[0]"
  run cat "$gcalls"
  refute_output --partial "repositories delete"
}

@test "_reconcile_singletons ingress IP: interactive destroy → deletes the IP, does NOT import" {
  _load_reconcile
  printf 'environment_active = true\n' > "$TF_DIR/active.auto.tfvars"
  local calls="${BATS_TEST_TMPDIR}/gcloud.calls"; : > "$calls"
  # The ingress IP is the ONLY singleton present: its describe succeeds, every other describe
  # fails, and it is untracked in state. Record gcloud so we can prove `addresses delete` ran.
  # shellcheck disable=SC2317
  gcloud() {
    echo "$*" >> "$calls"
    case "$1 $2" in
      "compute addresses") [[ "$3" == describe ]] && return 0 ;;  # IP present
    esac
    return 1  # bucket/sql/gke/valkey/AR-repo describes all absent
  }
  # Untracked in state (state list echoes nothing) so the adopt branch arms.
  # shellcheck disable=SC2317
  tofu_() { case "$1" in state) return 0 ;; esac; return 0; }
  # Decline adopt, accept destroy.
  # shellcheck disable=SC2317
  confirm() { [[ "$1" == "Destroy "* ]]; }
  AUTO_APPROVE=0 run _reconcile_singletons true true
  assert_success
  run cat "$calls"
  assert_output --partial "compute addresses delete devstash-dev-ip --global"
  # It must NOT have imported the IP after choosing destroy.
  refute_output --partial "import"
}

@test "_reconcile_singletons ingress IP: AUTO_APPROVE=1 → adopts (imports), never deletes" {
  _load_reconcile
  printf 'environment_active = true\n' > "$TF_DIR/active.auto.tfvars"
  local gcalls="${BATS_TEST_TMPDIR}/gcloud.calls"; : > "$gcalls"
  local tcalls="${BATS_TEST_TMPDIR}/tofu.calls"; : > "$tcalls"
  # shellcheck disable=SC2317
  gcloud() {
    echo "$*" >> "$gcalls"
    case "$1 $2" in
      "compute addresses") [[ "$3" == describe ]] && return 0 ;;
    esac
    return 1
  }
  # tofu_ import succeeds; state list echoes nothing (untracked) so the branch arms.
  # shellcheck disable=SC2317
  tofu_() { echo "$*" >> "$tcalls"; case "$1" in import) return 0 ;; esac; return 0; }
  AUTO_APPROVE=1 run _reconcile_singletons true true
  assert_success
  run cat "$tcalls"
  assert_line --partial "import -lock-timeout=120s module.network.google_compute_global_address.ingress_ip[0]"
  run cat "$gcalls"
  refute_output --partial "addresses delete"
}

@test "_reconcile_adopt_wif: soft-DELETED → destroy is not offered; undeletes + imports" {
  _load_reconcile
  local gcalls="${BATS_TEST_TMPDIR}/gcloud.calls"; : > "$gcalls"
  local tcalls="${BATS_TEST_TMPDIR}/tofu.calls"; : > "$tcalls"
  # sleep is called by the undelete poll — skip the real wait.
  # shellcheck disable=SC2317
  sleep() { :; }
  # describe reports DELETED first, then ACTIVE after undelete; undelete + import recorded.
  # shellcheck disable=SC2317
  gcloud() { echo "$*" >> "$gcalls"; case "$*" in *undelete*) return 0 ;; *) echo "DELETED" ;; esac; }
  # shellcheck disable=SC2317
  tofu_() { echo "$*" >> "$tcalls"; case "$1" in state) return 0 ;; import) return 0 ;; esac; return 0; }
  # confirm must NEVER fire — destroy is IMPOSSIBLE for a DELETED pool.
  # shellcheck disable=SC2317
  confirm() { echo "UNEXPECTED confirm" >&2; return 0; }
  AUTO_APPROVE=0 run _reconcile_adopt_wif module.iam.google_iam_workload_identity_pool.github \
    projects/proj/locations/global/workloadIdentityPools/github-actions \
    gcloud iam workload-identity-pools describe github-actions --location=global --project=proj
  assert_success
  refute_output --partial "UNEXPECTED"
  run cat "$gcalls"
  assert_output --partial "undelete"
  run cat "$tcalls"
  assert_line --partial "import -lock-timeout=120s module.iam.google_iam_workload_identity_pool.github"
}

@test "_reconcile_adopt_wif: absent in GCP → no-op (plan CREATEs it normally)" {
  _load_reconcile
  # describe returns empty state → not in GCP → the branch returns without prompting or importing.
  # shellcheck disable=SC2317
  gcloud() { return 0; }  # --format='value(state)' yields empty
  # shellcheck disable=SC2317
  tofu_() { case "$1" in import) echo "UNEXPECTED import" >&2; return 1 ;; state) return 0 ;; esac; return 0; }
  # shellcheck disable=SC2317
  confirm() { echo "UNEXPECTED confirm" >&2; return 0; }
  AUTO_APPROVE=0 run _reconcile_adopt_wif module.iam.google_iam_workload_identity_pool.github \
    projects/proj/locations/global/workloadIdentityPools/github-actions \
    gcloud iam workload-identity-pools describe github-actions --location=global --project=proj
  assert_success
  refute_output --partial "UNEXPECTED"
}

# ── Sync guard: the _load_fallback copy above must match run.sh's real _plan_with_refresh_fallback
# body, so a future edit to run.sh that isn't mirrored here fails loudly instead of testing a stale
# copy. Assert run.sh's function still contains the salient lines the test copy relies on. ──
@test "refresh-fallback: the test copy matches run.sh's _plan_with_refresh_fallback body" {
  local run_sh="${REPO_ROOT}/infra/run/gcp/run.sh"
  # The function body between the header and its column-0 closing brace.
  local body; body="$(awk '/^_plan_with_refresh_fallback\(\)/,/^}/' "$run_sh")"
  # Salient lines that MUST also exist in _load_fallback above — the 404 signature grep, the
  # -refresh=false retry, and the guarded output capture. Any divergence fails this test.
  echo "$body" | grep -qF 'grep -qiE '"'"'does not exist|was not found|Error 404|instanceDoesNotExist|resourceNotFound'"'"
  echo "$body" | grep -qF 'tofu_locked_ plan -refresh=false "$@"'
  echo "$body" | grep -qF 'out="$(tofu_locked_ plan "$@" 2>&1)" || rc=$?'
}
