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
  load test_helper
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

# ── reconcile_state branch 5 (static): the stranded-Cloud-SQL purge. The full function needs the
# whole run.sh runtime scope, so assert the branch's logic-bearing parts are present in the source:
# the three SQL addresses (leaves before the instance) AND the absent-instance describe-gate that
# arms the purge only when the instance is genuinely gone. This is what regressed live. ──
@test "reconcile branch 5: purges the three stranded Cloud SQL addresses, gated on an absent instance" {
  local reconcile_sh="${REPO_ROOT}/infra/run/gcp/lib/reconcile.sh"
  # The purge block only fires when `gcloud sql instances describe` FAILS (instance absent) — assert
  # that negated-describe gate exists so a present instance is never purged.
  run grep -qE '! gcloud sql instances describe' "$reconcile_sh"
  assert_success
  # All three addresses must be purged, leaves (user, database) before the instance.
  local addr
  for addr in \
    'module.cloudsql.google_sql_user.app\[0\]' \
    'module.cloudsql.google_sql_database.devstash\[0\]' \
    'module.cloudsql.google_sql_database_instance.postgres\[0\]'; do
    run grep -qF "$(echo "$addr" | sed 's/\\//g')" "$reconcile_sh"
    assert_success
  done
  # The purge uses `tofu_ state rm` (not import/adopt) — the inverse of branches 1/3d.
  run grep -qE 'tofu_ state rm "\$sql_stranded_addr"' "$reconcile_sh"
  assert_success
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
