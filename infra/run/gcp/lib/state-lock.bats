#!/usr/bin/env bats
# Interactive state-lock recovery (run.sh _recover_state_lock / tofu_locked + the common.sh lock
# primitives). Two layers:
#   UNIT   — source common.sh, exercise the pure helpers (is_lock_error / describe_lock / read_tflock).
#   RECOVER — drive `run.sh unlock` with gcloud/gh/tofu/pgrep stubbed via bats-mock, asserting the
#             observable outcome AND (where it matters) the args a collaborator was called with
#             (e.g. force-unlock got the lock ID from the .tflock).
# External commands are stubbed with bats-mock; JSON fixtures live under __fixtures__/.

setup() {
  load "${BATS_TEST_DIRNAME}/../../../lib/test_helper"
  # The GCS object generation of the .tflock — the value `tofu force-unlock` needs on the GCS
  # backend (NOT held-lock.json's UUID "ID"). Numeric, and distinct from that UUID on purpose.
  export TFLOCK_GENERATION=1783293155440141
}

# ── UNIT: pure common.sh helpers ─────────────────────────────────────────────────────────────
@test "is_lock_error matches the real acquire-failure output" {
  source "${REPO_ROOT}/infra/lib/common.sh"
  run is_lock_error $'Error: Error acquiring the state lock\n\nError message: writing "…/default.tflock" failed'
  assert_success
}

@test "is_lock_error rejects unrelated tofu output" {
  source "${REPO_ROOT}/infra/lib/common.sh"
  run is_lock_error "Apply complete! Resources: 3 added, 0 changed."
  assert_failure
}

@test "describe_lock prints the holder ID, Who, and a relative age" {
  source "${REPO_ROOT}/infra/lib/common.sh"
  run describe_lock "$(fixture_contents held-lock.json)"
  assert_output --partial "ce7ace5f-ada3-25a0-f88a-a7ec9dac342d"
  assert_output --partial "ci@build-worker.invalid"
  # Either a computed "<n>d ago" age or the raw timestamp (date-parse fallback) is acceptable.
  assert_output --regexp '[0-9]+(m|h|d) ago|2026-07-05'
}

@test "describe_lock no-ops on empty input" {
  source "${REPO_ROOT}/infra/lib/common.sh"
  run describe_lock ""
  assert_output ""
}

@test "describe_lock falls back to the raw timestamp when Created is unparseable" {
  source "${REPO_ROOT}/infra/lib/common.sh"
  local json; json="$(jq '.Created = "not-a-date"' "$(fixture held-lock.json)")"
  run describe_lock "$json"
  assert_success
  assert_output --partial "not-a-date"
}

@test "read_tflock returns the .tflock JSON when the object exists" {
  source "${REPO_ROOT}/infra/lib/common.sh"
  stub gcloud "storage cat * : cat '$(fixture held-lock.json)'"
  run read_tflock "gs://b/gke/dev/" "default"
  assert_success
  assert_output --partial "ce7ace5f-ada3-25a0-f88a-a7ec9dac342d"
  unstub gcloud
}

@test "read_tflock returns empty when the object is gone (404)" {
  source "${REPO_ROOT}/infra/lib/common.sh"
  stub gcloud "storage cat * : exit 1"   # gcloud non-zero → read_tflock swallows to empty
  run read_tflock "gs://b/gke/dev/" "default"
  assert_success
  assert_output ""
  unstub gcloud
}

# ── UNIT: tofu_locked's retry-once bound ─────────────────────────────────────────────────────
# tofu_locked is generic over its invoker + recovery callback (run.sh binds them to tofu_ /
# _recover_state_lock via tofu_locked_) — tested here directly against fakes so the retry-once
# bound is verified without standing up run.sh's full apply()/preflight chain.
_fake_tofu_invoker() {
  # tofu_locked runs the invoker on the LEFT of a `| tee` pipeline, so it executes in a subshell —
  # any plain variable mutation here would be lost to the parent. Use $TOFU_CALLS (a file, one
  # line appended per call) as the call counter and consume $TOFU_OUTCOMES (space-separated,
  # scripted per-test) by call number rather than by popping a shared variable.
  printf 'call\n' >> "$TOFU_CALLS"
  local n; n="$(grep -c '' "$TOFU_CALLS")"
  local outcomes; read -r -a outcomes <<<"$TOFU_OUTCOMES"
  case "${outcomes[$((n - 1))]}" in
    success) echo "Apply complete! Resources: 1 added, 0 changed." ;;
    lock)    echo "Error: Error acquiring the state lock"; return 1 ;;
    other)   echo "Error: some unrelated tofu failure"; return 1 ;;
  esac
}

@test "tofu_locked: lock error then success on retry → recovers, retries exactly once, returns 0" {
  source "${REPO_ROOT}/infra/lib/common.sh"
  TOFU_CALLS="${BATS_TEST_TMPDIR}/tofu_calls"; : > "$TOFU_CALLS"
  TOFU_OUTCOMES="lock success"
  _fake_recover() { return 0; }
  run tofu_locked _fake_recover -- _fake_tofu_invoker plan
  assert_success
  assert_output --partial "Apply complete"
  [ "$(grep -c '' "$TOFU_CALLS")" -eq 2 ]
}

@test "tofu_locked: a second lock failure after recovery re-propagates instead of looping" {
  source "${REPO_ROOT}/infra/lib/common.sh"
  TOFU_CALLS="${BATS_TEST_TMPDIR}/tofu_calls"; : > "$TOFU_CALLS"
  TOFU_OUTCOMES="lock lock"
  _fake_recover() { return 0; }
  run tofu_locked _fake_recover -- _fake_tofu_invoker plan
  assert_failure
  # Exactly 2 invocations (initial + the one bounded retry) — a regression that loops would call
  # _fake_tofu_invoker a 3rd time and this count would catch it.
  [ "$(grep -c '' "$TOFU_CALLS")" -eq 2 ]
}

@test "tofu_locked: recovery declined → re-propagates the original lock failure without retrying" {
  source "${REPO_ROOT}/infra/lib/common.sh"
  TOFU_CALLS="${BATS_TEST_TMPDIR}/tofu_calls"; : > "$TOFU_CALLS"
  TOFU_OUTCOMES="lock"
  _fake_recover() { return 1; }
  run tofu_locked _fake_recover -- _fake_tofu_invoker plan
  assert_failure
  [ "$(grep -c '' "$TOFU_CALLS")" -eq 1 ]
}

@test "tofu_locked: a non-lock failure re-propagates immediately without calling recovery" {
  source "${REPO_ROOT}/infra/lib/common.sh"
  TOFU_CALLS="${BATS_TEST_TMPDIR}/tofu_calls"; : > "$TOFU_CALLS"
  TOFU_OUTCOMES="other"
  _fake_recover() { fail "recovery must not run for a non-lock failure"; }
  run tofu_locked _fake_recover -- _fake_tofu_invoker plan
  assert_failure
  assert_output --partial "unrelated tofu failure"
  [ "$(grep -c '' "$TOFU_CALLS")" -eq 1 ]
}

# ── RECOVER: drive `run.sh unlock` end-to-end with collaborators stubbed ──────────────────────
# gcloud + pgrep are CONDITIONAL collaborators (the recovery returns early on an empty lock; the
# local-PID branch only runs when the lock host == this machine), so they are NON-verified
# fake_cmd stubs: asserting exact call counts on them would be brittle. `tofu` IS verified via
# bats-mock stub/unstub — that is where we spy on force-unlock's args. gh must never be reached
# on the unlock path (no DEPLOY_RUN_ID) unless a test opts in; a fake_cmd that fails loud catches
# a regression that tries.
#
# held-lock.json's Who ("ci@build-worker.invalid") never matches this test runner's hostname and
# no test here sets DEPLOY_RUN_ID or an ongoing build — so by itself it is the UNIDENTIFIABLE-
# holder case (see the dedicated test below), not a confirmed-dead one. Confirmed-dead local-PID
# and confirmed-dead CI-run cases each get their own fixture/mode below.
_fake_collaborators() {
  # $1 = held | none | dead-local : which .tflock (if any) `gcloud storage cat` yields, and
  #      whether pgrep reports a live local tofu/terraform PID.
  local mode="$1" cat_line pgrep_line
  case "$mode" in
    held)       cat_line="cat '$(fixture held-lock.json)'"; pgrep_line='exit 1' ;;
    none)       cat_line="exit 1"; pgrep_line='exit 1' ;;
    dead-local) cat_line="cat '${BATS_TEST_TMPDIR}/local-lock.json'"; pgrep_line='exit 1' ;;
    *) fail "_fake_collaborators: unknown mode '$mode'" ;;
  esac
  # storage objects describe → the .tflock GENERATION (what force-unlock needs on GCS), served ONLY
  # when a lock is present. Deliberately DIFFERENT from held-lock.json's "ID" (a UUID) so a
  # regression that force-unlocks by the JSON ID instead of the generation fails the plan match.
  local gen_line; [[ "$mode" == none ]] && gen_line='exit 1' || gen_line="echo ${TFLOCK_GENERATION}"
  fake_cmd gcloud "
    case \"\$1 \$2\" in
      'storage buckets') exit 0 ;;                 # describe: bucket exists
      'storage cat')     ${cat_line} ;;            # the .tflock (or 404)
      'storage objects') ${gen_line} ;;            # the .tflock generation (or 404)
      'builds list')     exit 0 ;;                  # no ongoing auto-suspend build
      *) exit 0 ;;
    esac"
  fake_cmd pgrep "$pgrep_line"
  fake_cmd gh 'echo "gh-should-not-run $*" >&2; exit 3'
}

@test "unlock: no lock present reports 'already released' and never calls force-unlock" {
  _fake_collaborators none
  # Plan has ONLY init (repeated). A call to force-unlock would have no matching plan line → the
  # binstub exits 127 → run.sh's unlock fails, catching a regression that releases a non-lock.
  stub_repeated tofu "* init * : true"
  AUTO_APPROVE=1 STATE_BUCKET=stub-bucket run bash "$RUN_SH" unlock
  assert_success
  assert_output --partial "already released"
  unstub tofu
}

@test "unlock: interactive 'y' releases an unidentifiable holder by the .tflock GENERATION" {
  _fake_collaborators held
  # force-unlock must use the GCS object generation (from `storage objects describe`), NOT the JSON
  # "ID" UUID — the plan pins the generation, so a regression that passes the UUID fails the match.
  stub tofu "* init * : true" "* force-unlock -force ${TFLOCK_GENERATION} : true"
  # Not AUTO_APPROVE: the only confirm reached is the stronger "release ANYWAY?" gate, since the
  # holder could not be identified (foreign host, no CI run) — see the AUTO_APPROVE test below for
  # why that same case must REFUSE rather than prompt when unattended.
  STATE_BUCKET=stub-bucket run bash "$RUN_SH" unlock <<<"y"
  assert_success
  assert_output --partial "could not be confirmed dead"
  unstub tofu
}

@test "unlock: force-unlock uses the numeric generation, NEVER the JSON ID UUID (regression)" {
  # The real incident: force-unlock was passed the .tflock JSON "ID" (a UUID) and GCS rejected it
  # with "Lock ID should be numerical value", so the lock was never released. Pin the generation in
  # the plan AND forbid the UUID: if recovery regresses to the UUID, the plan match fails here.
  _fake_collaborators held
  # The tofu plan ONLY matches `force-unlock -force <generation>`. If recovery regressed to passing
  # the JSON "ID" UUID, that call would not match this plan line → the stub exits 127 → unlock fails.
  # (The UUID still appears in describe_lock's DISPLAY output — that is correct — so we assert the
  # release path via the plan match, not by scanning output.)
  stub tofu "* init * : true" "* force-unlock -force ${TFLOCK_GENERATION} : true"
  STATE_BUCKET=stub-bucket run bash "$RUN_SH" unlock <<<"y"
  assert_success
  unstub tofu
}

@test "unlock: interactive 'n' declines — lock left in place, exits non-zero" {
  _fake_collaborators held
  stub_repeated tofu "* init * : true"   # no force-unlock plan line → releasing would fail the test
  STATE_BUCKET=stub-bucket run bash "$RUN_SH" unlock <<<"n"
  assert_failure
  unstub tofu
}

@test "unlock: AUTO_APPROVE refuses to release a holder that could not be identified as dead" {
  # held-lock.json's Who never matches this machine and no CI run/build is ongoing — the holder
  # category is simply unknown, not confirmed dead. AUTO_APPROVE must NOT silently release here:
  # doing so would force-unlock a possibly-live holder unattended (the exact bug this test guards).
  _fake_collaborators held
  stub_repeated tofu "* init * : true"   # no force-unlock plan line — releasing would fail the test
  AUTO_APPROVE=1 STATE_BUCKET=stub-bucket run bash "$RUN_SH" unlock
  assert_failure
  assert_output --partial "could not be confirmed dead"
  assert_output --partial "AUTO_APPROVE=1 refuses"
  unstub tofu
}

@test "unlock: AUTO_APPROVE releases a lock confirmed dead via a matching local host with no live PID" {
  # Who's host == this test runner's hostname (positively identified) AND pgrep finds no matching
  # PID (positively confirmed dead) — the one AUTO_APPROVE case that SHOULD release unattended.
  jq --arg who "ci@$(hostname)" '.Who = $who' "$(fixture held-lock.json)" > "${BATS_TEST_TMPDIR}/local-lock.json"
  _fake_collaborators dead-local
  stub tofu "* init * : true" "* force-unlock -force ${TFLOCK_GENERATION} : true"
  AUTO_APPROVE=1 STATE_BUCKET=stub-bucket run bash "$RUN_SH" unlock
  assert_success
  unstub tofu
}

@test "unlock: a gh probe failure for the pre-dispatched run is treated as potentially alive, not dead" {
  # DEPLOY_RUN_ID is set but `gh run view` itself fails (auth/network) rather than cleanly
  # reporting a status — this must NOT be read the same as "the run already finished".
  _fake_collaborators held
  fake_cmd gh 'case "$1 $2" in "run view") exit 1 ;; *) echo "gh-should-not-run $*" >&2; exit 3 ;; esac'
  stub_repeated tofu "* init * : true"   # no force-unlock plan line — releasing would fail the test
  AUTO_APPROVE=1 DEPLOY_RUN_ID=999 STATE_BUCKET=stub-bucket run bash "$RUN_SH" unlock
  assert_failure
  assert_output --partial "could not query status of GitHub Actions run 999"
  assert_output --partial "AUTO_APPROVE=1 refuses"
  unstub tofu
}

@test "unlock: a malformed .tflock object fails gracefully instead of crashing the script" {
  fake_cmd gcloud '
    case "$1 $2" in
      "storage buckets") exit 0 ;;
      "storage cat")     printf "not-json-at-all" ;;
      "builds list")     exit 0 ;;
      *) exit 0 ;;
    esac'
  fake_cmd pgrep 'exit 1'
  fake_cmd gh 'echo "gh-should-not-run $*" >&2; exit 3'
  stub_repeated tofu "* init * : true"   # no force-unlock plan line — a crash or bad ID would surface here
  AUTO_APPROVE=1 STATE_BUCKET=stub-bucket run bash "$RUN_SH" unlock
  # Malformed JSON has no parseable ID, so recovery cannot force-unlock — it must fail loudly and
  # say why, not abort mid-script with a raw `jq: parse error` under set -e.
  assert_failure
  refute_output --partial "parse error"
  unstub tofu
}

# ── PROBE UNITS: the three holder probes _recover_state_lock folds. Each was extracted from that
# function's body so it can be driven directly here (source run.sh — its dispatch guard keeps main
# from running — set the run.sh globals, stub collaborators, call the probe, assert the PROBE_*
# verdict globals). The end-to-end `unlock` tests above remain the integration regression net; these
# pin each probe's own verdict logic in isolation. ──
_load_probes() {
  export PROJECT_ID=proj REGION=us-central1 ENVIRONMENT=dev STATE_BUCKET=proj-tfstate-dev TF_DIR=/tmp/tf
  source "$RUN_SH"
  AUTO_APPROVE=1  # confirm() auto-yes so the cancel/kill paths run without stdin
  # shellcheck disable=SC2317  # collaborators invoked indirectly via the probe under test
  log() { :; }
  # shellcheck disable=SC2317
  ok() { :; }
  # shellcheck disable=SC2317
  warn() { :; }
}

@test "_probe_holder_build: no ongoing build → not identified, alive kept" {
  _load_probes
  # shellcheck disable=SC2317
  _ongoing_autosuspend_build_ids() { :; }  # no build ids
  _probe_holder_build
  [ "$PROBE_IDENTIFIED" -eq 0 ]
  [ "$PROBE_ALIVE" = keep ]
}

@test "_probe_holder_build: ongoing build cancelled → identified + confirmed dead (set0)" {
  _load_probes
  # shellcheck disable=SC2317
  _ongoing_autosuspend_build_ids() { echo b123; }
  # shellcheck disable=SC2317
  gcloud() { return 0; }  # cancel succeeds
  _probe_holder_build
  [ "$PROBE_IDENTIFIED" -eq 1 ]
  [ "$PROBE_ALIVE" = set0 ]
}

@test "_probe_holder_build: ongoing build, cancel fails → identified but alive kept" {
  _load_probes
  # shellcheck disable=SC2317
  _ongoing_autosuspend_build_ids() { echo b123; }
  # shellcheck disable=SC2317
  gcloud() { return 1; }  # cancel fails (may have already finished)
  _probe_holder_build
  [ "$PROBE_IDENTIFIED" -eq 1 ]
  [ "$PROBE_ALIVE" = keep ]
}

@test "_probe_holder_gh_run: unset run id → not identified, alive kept" {
  _load_probes
  _probe_holder_gh_run ""
  [ "$PROBE_IDENTIFIED" -eq 0 ]
  [ "$PROBE_ALIVE" = keep ]
}

@test "_probe_holder_gh_run: gh probe FAILS → identified, alive kept (potentially alive, not dead)" {
  _load_probes
  # shellcheck disable=SC2317
  gh() { return 1; }  # gh run view itself errors (auth/network) — NOT the same as "finished"
  _probe_holder_gh_run 999
  [ "$PROBE_IDENTIFIED" -eq 1 ]
  [ "$PROBE_ALIVE" = keep ]
}

@test "_probe_holder_gh_run: run finished → identified + confirmed dead (set0)" {
  _load_probes
  # shellcheck disable=SC2317
  gh() { echo completed; }  # a terminal status, not in_progress/queued
  _probe_holder_gh_run 999
  [ "$PROBE_IDENTIFIED" -eq 1 ]
  [ "$PROBE_ALIVE" = set0 ]
}

@test "_probe_holder_gh_run: in_progress + cancel ok → identified + set0" {
  _load_probes
  # The probe calls `gh run view` (→ status) then `gh run cancel`; dispatch on $2.
  # shellcheck disable=SC2317
  gh() { case "$2" in view) echo in_progress ;; cancel) return 0 ;; esac; }
  _probe_holder_gh_run 999
  [ "$PROBE_IDENTIFIED" -eq 1 ]
  [ "$PROBE_ALIVE" = set0 ]
}

@test "_probe_holder_local_pid: foreign host → not identified, alive kept" {
  _load_probes
  _probe_holder_local_pid "some-other-host.invalid"
  [ "$PROBE_IDENTIFIED" -eq 0 ]
  [ "$PROBE_ALIVE" = keep ]
}

@test "_probe_holder_local_pid: matching host, no live PID → identified + confirmed dead (set0)" {
  _load_probes
  # shellcheck disable=SC2317
  pgrep() { :; }  # no matching tofu/terraform PID
  _probe_holder_local_pid "$(hostname)"
  [ "$PROBE_IDENTIFIED" -eq 1 ]
  [ "$PROBE_ALIVE" = set0 ]
}

@test "_probe_holder_local_pid: matching host, live PID declined → identified + still alive (set1)" {
  _load_probes
  # A PID that is genuinely alive: use this shell's own PID, which kill -0 confirms.
  # shellcheck disable=SC2317
  pgrep() { echo "$$"; }
  # shellcheck disable=SC2317
  confirm() { return 1; }  # decline to kill → holder stays alive
  _probe_holder_local_pid "$(hostname)"
  [ "$PROBE_IDENTIFIED" -eq 1 ]
  [ "$PROBE_ALIVE" = set1 ]
}
