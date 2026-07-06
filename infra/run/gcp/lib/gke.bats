#!/usr/bin/env bats
# Fail-fast join used by the parallel bring-up/resume overlaps. _join_fail_fast (gke.sh) is the
# single-sourced `wait -n -p` loop that folds N independent backgrounded jobs — the ESO ‖ Reloader
# installs and the backgrounded apply exec — under one wait: it returns 0 only once ALL exit 0, and
# the instant the FIRST exits non-zero it kills every surviving sibling and `die`s. That kill-the-
# survivors-on-failure branch is the logic-bearing, easy-to-break, costly-to-get-wrong part (a leaked
# helm install or a half-run apply left detached after an abort), so it is what this suite drives
# directly. Extracted verbatim (a sync guard below asserts the copy matches gke.sh) so it runs
# without sourcing all of run.sh's scope.

setup() {
  load "${BATS_TEST_DIRNAME}/../../../lib/test_helper"
}

# _load_join: install a test copy of _join_fail_fast (+ the fmt_dur/ok collaborators it calls), with
# `die` stubbed. The _join_fail_fast body MUST stay byte-identical to gke.sh's copy — the sync guard
# at the bottom enforces it.
_load_join() {
  # die records its message then EXITS non-zero, faithfully to common.sh's real die (which calls
  # exit). Running the join in a `( … )` subshell lets that exit abort it exactly as production would
  # — WITHOUT terminating the outer bats process. A plain `return 1` would NOT be faithful: control
  # would fall back into the wait loop, which would then reap the remaining (successful) siblings and
  # exit 0, masking the failure.
  # shellcheck disable=SC2317  # invoked indirectly by the function under test
  die() { printf 'DIE: %s\n' "$*"; exit 1; }
  # ok mirrors common.sh closely enough for the assertions here: it prints "  ✓ <msg>" (the per-path
  # finish line the label tests grep for) minus the real ANSI + timestamp, keeping the greps simple.
  # shellcheck disable=SC2317
  ok() { printf '  ✓ %s\n' "$*"; }
  # fmt_dur is sourced from the REAL common.sh (not copied) so the label-duration assertions exercise
  # the actual renderer — a format change there is reflected here instead of silently drifting.
  # shellcheck source=/dev/null
  source <(awk '/^fmt_dur\(\)/,/^}/' "$COMMON_SH")
  # shellcheck disable=SC2317  # invoked indirectly via the tests
  _join_fail_fast() {
    local die_msg="$1"; local labels_ref="$2"; shift 2
    local -n labels="${labels_ref:-_JFF_NOLABELS}"   # nameref to the caller's map, or an empty fallback
    local -A _JFF_NOLABELS=()
    local pending=("$@") finished rc p kept
    while [[ "${#pending[@]}" -gt 0 ]]; do
      finished=""; rc=0
      wait -n -p finished "${pending[@]}" || rc=$?
      if [[ "$rc" -ne 0 ]]; then
        for p in "${pending[@]}"; do [[ "$p" != "$finished" ]] && kill "$p" 2>/dev/null || true; done
        die "$die_msg (a joined job exited $rc)"
      fi
      if [[ -n "$finished" ]]; then
        [[ -n "${labels[$finished]:-}" ]] && ok "[${labels[$finished]}] done in $(fmt_dur "$(( SECONDS - ${_JFF_T0:-SECONDS} ))")"
        kept=()
        for p in "${pending[@]}"; do [[ "$p" != "$finished" ]] && kept+=("$p"); done
        pending=(${kept[@]+"${kept[@]}"})
      else
        pending=()
      fi
    done
    return 0
  }
}

# NOTE ON TEST STRUCTURE: the join must `wait` on its OWN children, and bats' `run` forks a subshell,
# so a job spawned in the test body is not the run-subshell's child. Every test therefore spawns the
# jobs AND calls the join together inside ONE `( … )` subshell, capturing its stdout to a file and its
# status via a variable (grep the file — bats-assert's assert_line needs `run`'s $lines, which we
# avoid here). On the failure paths `die` (exit) aborts that subshell and $? carries the status back.

@test "join: all jobs succeed → returns 0, no die" {
  _load_join
  local out="${BATS_TEST_TMPDIR}/out" st=0
  ( ( exit 0 ) & a=$!
    ( exit 0 ) & b=$!
    ( exit 0 ) & c=$!
    _join_fail_fast "should not fire" "" "$a" "$b" "$c"
  ) >"$out" 2>&1 || st=$?
  [[ "$st" -eq 0 ]] || fail "expected success, got $st: $(cat "$out")"
  run grep -qF "DIE:" "$out"; assert_failure           # no die fired
}

@test "join: a failing job trips die, carrying the caller message + the exit code" {
  _load_join
  local out="${BATS_TEST_TMPDIR}/out" st=0
  ( ( exit 0 )        & ok_pid=$!
    ( sleep 0.2; exit 7 ) & bad_pid=$!
    _join_fail_fast "resume overlap failed" "" "$ok_pid" "$bad_pid"
  ) >"$out" 2>&1 || st=$?
  [[ "$st" -ne 0 ]] || fail "expected failure, got success: $(cat "$out")"
  run grep -qF "DIE: resume overlap failed (a joined job exited 7)" "$out"; assert_success
}

@test "join: the surviving siblings are KILLED when one job fails (no detached leftovers)" {
  _load_join
  # A long-lived sibling writes a sentinel ONLY if allowed to finish. If the join kills it when the
  # other job fails, the sentinel is never written; its pid (via a file) must also be dead afterward.
  local sentinel="${BATS_TEST_TMPDIR}/survivor-finished" pidfile="${BATS_TEST_TMPDIR}/survivor.pid" st=0
  ( ( sleep 5; : > "$sentinel" ) & echo "$!" > "$pidfile"
    ( exit 3 ) & bad_pid=$!
    _join_fail_fast "overlap failed" "" "$(cat "$pidfile")" "$bad_pid"
  ) >/dev/null 2>&1 || st=$?
  [[ "$st" -ne 0 ]] || fail "expected failure"
  run test -e "$sentinel"; assert_failure              # sentinel never written → survivor was killed
  run kill -0 "$(cat "$pidfile")"; assert_failure      # survivor is dead, not merely un-awaited
}

@test "join: an empty pending set is a no-op success" {
  _load_join
  local st=0
  _join_fail_fast "should not fire" "" >/dev/null 2>&1 || st=$?
  [[ "$st" -eq 0 ]] || fail "expected success, got $st"
}

# ── Label + per-path duration narration (the resume transparency feature) ──
# The caller passes the NAME of a declare -A pid→label map; each labelled pid announces on join,
# with the duration measured from _JFF_T0 (the group's start).
@test "join: a labelled pid prints its own '✓ [label] done in <dur>' on finish" {
  _load_join
  local out="${BATS_TEST_TMPDIR}/out" st=0
  ( _JFF_T0=$(( SECONDS - 2 ))        # pin a deterministic 2s elapsed
    ( exit 0 ) & p=$!
    declare -A m=(); m[$p]=apply
    _join_fail_fast "n/a" m "$p"
  ) >"$out" 2>&1 || st=$?
  [[ "$st" -eq 0 ]] || fail "expected success, got $st: $(cat "$out")"
  run grep -qF "✓ [apply] done in 2s" "$out"; assert_success
}

@test "join: a bare (unmapped) pid stays SILENT — no per-path line (back-compat)" {
  _load_join
  local out="${BATS_TEST_TMPDIR}/out" st=0
  ( ( exit 0 ) & p=$!
    _join_fail_fast "n/a" "" "$p"        # "" = no map → silent
  ) >"$out" 2>&1 || st=$?
  [[ "$st" -eq 0 ]] || fail "expected success, got $st"
  run grep -qF "done" "$out"; assert_failure          # no map → emits nothing
}

@test "join: only the mapped pids announce; an unmapped pid in the same join stays silent" {
  _load_join
  local out="${BATS_TEST_TMPDIR}/out" st=0
  ( _JFF_T0=$SECONDS
    ( exit 0 ) & a=$!
    ( exit 0 ) & b=$!
    declare -A m=(); m[$a]=eso        # b is intentionally NOT mapped
    _join_fail_fast "n/a" m "$a" "$b"
  ) >"$out" 2>&1 || st=$?
  [[ "$st" -eq 0 ]] || fail "expected success, got $st: $(cat "$out")"
  run grep -qF "✓ [eso] done" "$out"; assert_success
  run bash -c "grep -cF 'done' '$out'"; assert_output "1"   # exactly one announce (b stayed silent)
}

# ── Sync guard: the _load_join copy above must match gke.sh's real _join_fail_fast body, so a future
# edit to gke.sh that isn't mirrored here fails loudly instead of testing a stale copy. ──
@test "join: the test copy matches gke.sh's _join_fail_fast body" {
  local body; body="$(awk '/^_join_fail_fast\(\)/,/^}/' "$GKE_SH")"
  echo "$body" | grep -qF 'local -n labels="${labels_ref:-_JFF_NOLABELS}"'
  echo "$body" | grep -qF 'wait -n -p finished "${pending[@]}" || rc=$?'
  echo "$body" | grep -qF 'for p in "${pending[@]}"; do [[ "$p" != "$finished" ]] && kill "$p" 2>/dev/null || true; done'
  echo "$body" | grep -qF 'die "$die_msg (a joined job exited $rc)"'
  # The labelled per-path finish line, timed from the group's t0.
  echo "$body" | grep -qF '[[ -n "${labels[$finished]:-}" ]] && ok "[${labels[$finished]}] done in $(fmt_dur "$(( SECONDS - ${_JFF_T0:-SECONDS} ))")"'
  # A clean drain must return 0, not the while-condition's non-zero status.
  echo "$body" | grep -qF 'return 0'
}
