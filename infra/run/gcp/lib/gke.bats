#!/usr/bin/env bats
# Fail-fast join used by the parallel bring-up/resume overlaps. _join_fail_fast (gke.sh) is the
# single-sourced `wait -n -p` loop that folds N independent backgrounded jobs — the ESO ‖ Reloader
# installs, the backgrounded apply exec, and the Cloud-SQL-gated DB restore — under one wait: it
# returns 0 only once ALL exit 0, and the instant the FIRST exits non-zero it kills every surviving
# sibling and `die`s. That kill-the-survivors-on-failure branch is the logic-bearing, easy-to-break,
# costly-to-get-wrong part (a leaked helm install or a half-run apply left detached after an abort),
# so it is what this suite drives directly. Extracted verbatim (a sync guard below asserts the copy
# matches gke.sh) so it runs without sourcing all of run.sh's scope.

setup() {
  load test_helper
}

# _load_join: install test copies of _join_fail_fast_hook + its _join_fail_fast wrapper, with `die`
# stubbed. MUST stay byte-identical to gke.sh's copies — the sync guard at the bottom enforces it.
_load_join() {
  # die records its message then EXITS non-zero, faithfully to common.sh's real die (which calls
  # exit). `run` executes the function in a subshell, so the exit aborts the join exactly as
  # production would — WITHOUT terminating the outer bats process. A plain `return 1` would NOT be
  # faithful: control would fall back into the wait loop, which would then reap the remaining
  # (successful) siblings and exit 0, masking the failure.
  # shellcheck disable=SC2317  # invoked indirectly by the function under test
  die() { printf 'DIE: %s\n' "$*"; exit 1; }
  # shellcheck disable=SC2317  # invoked indirectly via the function under test
  _join_fail_fast_hook() {
    local hook_fn="$1" die_msg="$2"; shift 2
    local pending=("$@")
    local finished rc p kept
    local _JOIN_NEW_PIDS=()
    while [[ "${#pending[@]}" -gt 0 ]]; do
      finished=""; rc=0
      wait -n -p finished "${pending[@]}" || rc=$?
      if [[ "$rc" -ne 0 && -z "$finished" ]]; then
        kept=()
        for p in "${pending[@]}"; do kill -0 "$p" 2>/dev/null && kept+=("$p"); done
        pending=(${kept[@]+"${kept[@]}"})
        continue
      fi
      if [[ "$rc" -ne 0 ]]; then
        for p in "${pending[@]}"; do [[ "$p" != "$finished" ]] && kill "$p" 2>/dev/null || true; done
        die "$die_msg (a joined job exited $rc)"
      fi
      if [[ -n "$finished" ]]; then
        kept=()
        for p in "${pending[@]}"; do [[ "$p" != "$finished" ]] && kept+=("$p"); done
        pending=(${kept[@]+"${kept[@]}"})
        _JOIN_NEW_PIDS=()
        "$hook_fn" "$finished"
        [[ "${#_JOIN_NEW_PIDS[@]}" -gt 0 ]] && pending+=("${_JOIN_NEW_PIDS[@]}")
      else
        pending=()
      fi
    done
    return 0
  }
  # shellcheck disable=SC2317  # invoked indirectly via the tests
  _join_fail_fast() { _join_fail_fast_hook : "$@"; }
}

@test "join: all jobs succeed → returns 0, no die" {
  _load_join
  # The join must `wait` on its OWN children, so spawn the jobs AND run the join together inside ONE
  # subshell. bats' `run` (and bats' own job-control setup) otherwise leaves the pids un-waitable in
  # the test shell. Capture the subshell's stdout to a file + status via a var; grep the file (bats-
  # assert's assert_line needs `run`'s $lines, which we deliberately avoid here).
  local out="${BATS_TEST_TMPDIR}/out" st=0
  ( ( exit 0 ) & a=$!
    ( exit 0 ) & b=$!
    ( exit 0 ) & c=$!
    _join_fail_fast "should not fire" "$a" "$b" "$c"
  ) >"$out" 2>&1 || st=$?
  [[ "$st" -eq 0 ]] || fail "expected success, got $st: $(cat "$out")"
  run grep -qF "DIE:" "$out"; assert_failure           # no die fired
}

@test "join: a failing job trips die, carrying the caller message + the exit code" {
  _load_join
  # Spawn the jobs AND run the join together inside one subshell so the jobs are the wait-er's own
  # children; `die` (exit) aborts that subshell, and $? carries its status back here.
  local out="${BATS_TEST_TMPDIR}/out" st=0
  ( ( exit 0 ) & ok_pid=$!
    ( exit 7 ) & bad_pid=$!
    _join_fail_fast "resume overlap failed" "$ok_pid" "$bad_pid"
  ) >"$out" 2>&1 || st=$?
  [[ "$st" -ne 0 ]] || fail "expected failure, got success: $(cat "$out")"
  run grep -qF "DIE: resume overlap failed (a joined job exited 7)" "$out"; assert_success
}

@test "join: the surviving siblings are KILLED when one job fails (no detached leftovers)" {
  _load_join
  # A long-lived sibling writes a sentinel ONLY if allowed to finish. If the join kills it when the
  # other job fails, the sentinel is never written. survivor_pid is echoed out so we can assert it
  # was killed (no longer alive) after the join aborts.
  local sentinel="${BATS_TEST_TMPDIR}/survivor-finished" pidfile="${BATS_TEST_TMPDIR}/survivor.pid" st=0
  ( ( sleep 5; : > "$sentinel" ) & echo "$!" > "$pidfile"
    ( exit 3 ) & bad_pid=$!
    _join_fail_fast "overlap failed" "$(cat "$pidfile")" "$bad_pid"
  ) >/dev/null 2>&1 || st=$?
  [[ "$st" -ne 0 ]] || fail "expected failure"
  run test -e "$sentinel"; assert_failure            # sentinel never written → survivor was killed
  run kill -0 "$(cat "$pidfile")"; assert_failure    # survivor is dead, not merely un-awaited
}

@test "join: an empty pending set is a no-op success" {
  _load_join
  local st=0
  _join_fail_fast "should not fire" >/dev/null 2>&1 || st=$?
  [[ "$st" -eq 0 ]] || fail "expected success, got $st"
}

# ── Hook: a dependency-gated job is spawned when its dependency finishes, folded into the SAME
# join, and its own success/failure is honoured — the resume restore-gate contract. ──

@test "hook: fires on each finished pid and folds a hook-spawned job into the join" {
  _load_join
  # The hook watches for dep_pid finishing, then spawns a follow-up that writes a sentinel. The join
  # must not return until that hook-spawned follow-up also completes. Run in ONE subshell so the
  # seeds AND the hook-spawned job are children of the wait-er.
  local sentinel="${BATS_TEST_TMPDIR}/followup-ran" st=0
  ( ( exit 0 ) & other_pid=$!
    ( sleep 0.2; exit 0 ) & dep_pid=$!
    _hook() {
      [[ "$1" == "$dep_pid" ]] || return 0
      ( : > "$sentinel"; exit 0 ) & _JOIN_NEW_PIDS+=("$!")   # fold the follow-up into the join
    }
    _join_fail_fast_hook _hook "should not fire" "$other_pid" "$dep_pid"
  ) >/dev/null 2>&1 || st=$?
  [[ "$st" -eq 0 ]] || fail "expected success, got $st"
  run test -e "$sentinel"; assert_success              # hook-spawned follow-up ran to completion
}

@test "hook: a FAILED dependency short-circuits before the hook spawns the gated job" {
  _load_join
  local sentinel="${BATS_TEST_TMPDIR}/should-not-exist" out="${BATS_TEST_TMPDIR}/out" st=0
  ( ( exit 4 ) & dep_pid=$!
    _hook() { ( : > "$sentinel" ) & _JOIN_NEW_PIDS+=("$!"); }   # would spawn the gated job if ever called
    _join_fail_fast_hook _hook "restore gated on apply" "$dep_pid"
  ) >"$out" 2>&1 || st=$?
  [[ "$st" -ne 0 ]] || fail "expected failure"
  run grep -qF "DIE: restore gated on apply (a joined job exited 4)" "$out"; assert_success
  run test -e "$sentinel"; assert_failure              # gated job never spawned (aborted before hook)
}

@test "hook: a hook-spawned job that FAILS trips the join" {
  _load_join
  local out="${BATS_TEST_TMPDIR}/out" st=0
  ( ( exit 0 ) & dep_pid=$!
    _hook() { ( exit 9 ) & _JOIN_NEW_PIDS+=("$!"); }        # gated job fails
    _join_fail_fast_hook _hook "gated job failed" "$dep_pid"
  ) >"$out" 2>&1 || st=$?
  [[ "$st" -ne 0 ]] || fail "expected failure"
  run grep -qF "DIE: gated job failed (a joined job exited 9)" "$out"; assert_success
}

# ── Sync guard: the _load_join copies above must match gke.sh's real _join_fail_fast_hook +
# _join_fail_fast bodies, so a future edit to gke.sh that isn't mirrored here fails loudly instead
# of testing a stale copy. ──
@test "join: the test copy matches gke.sh's _join_fail_fast_hook body" {
  local body; body="$(awk '/^_join_fail_fast_hook\(\)/,/^}/' "$GKE_SH")"
  echo "$body" | grep -qF 'wait -n -p finished "${pending[@]}" || rc=$?'
  echo "$body" | grep -qF 'for p in "${pending[@]}"; do [[ "$p" != "$finished" ]] && kill "$p" 2>/dev/null || true; done'
  echo "$body" | grep -qF 'die "$die_msg (a joined job exited $rc)"'
  # The hook is called PLAINLY (not `$(...)`, which would orphan a job it spawns) and communicates
  # new pids via _JOIN_NEW_PIDS — the load-bearing contract the resume restore-gate depends on.
  echo "$body" | grep -qF '"$hook_fn" "$finished"'
  echo "$body" | grep -qF '[[ "${#_JOIN_NEW_PIDS[@]}" -gt 0 ]] && pending+=("${_JOIN_NEW_PIDS[@]}")'
  # The already-reaped-pid prune branch (rc!=0 with no finished pid) must be present — without it a
  # pid that vanished between iterations is misread as a job failure (the 127 regression).
  echo "$body" | grep -qF 'if [[ "$rc" -ne 0 && -z "$finished" ]]; then'
  echo "$body" | grep -qF 'for p in "${pending[@]}"; do kill -0 "$p" 2>/dev/null && kept+=("$p"); done'
  # A clean drain must return 0, not the while-condition's non-zero status.
  echo "$body" | grep -qF 'return 0'
  # And the hookless wrapper delegates with a no-op hook.
  grep -qF '_join_fail_fast() { _join_fail_fast_hook : "$@"; }' "$GKE_SH"
}
