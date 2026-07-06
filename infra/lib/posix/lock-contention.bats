#!/usr/bin/env bats
# Shared auto-suspend state-lock contention helpers (lock-contention.sh):
#   ds_older_autosuspend_build_running — layer-1 dedup tiebreak (older sibling wins → defer).
#   ds_force_unlock_if_dead            — layer-3 guarded force-unlock (break ONLY an orphaned lock).
# Sources the POSIX-sh lib into bash; `gcloud`/`tofu` are spied via spy_cmd (test_helper). The two
# fragile parts under test: (a) the createTime tiebreak, including the exact-tie boundary that must
# NOT defer, and (b) the force-unlock safety gates that must NEVER break a live or unparseable lock.
# The real auto-suspend-lock-id.py (stdlib-only) does the JSON→ID extraction — no stub, faithful.

setup() {
  load "${BATS_TEST_DIRNAME}/../test_helper"
  # shellcheck source=infra/lib/posix/lock-contention.sh
  source "${REPO_ROOT}/infra/lib/posix/lock-contention.sh"
  LOCK_ID_PY="${REPO_ROOT}/infra/terraform/envs/dev/scripts/auto-suspend-lock-id.py"
}

# ── ds_older_autosuspend_build_running — createTime tiebreak ─────────────────────────────────
# Router: `builds describe` → this build's createTime ($SELF_CREATED); `builds list` → sibling
# "id<TAB>createTime" rows ($SIBLINGS). Both are supplied per-test via the spy's environment.
_tiebreak_router='
  case "$1 $2" in
    "builds describe") printf "%s\n" "$SELF_CREATED" ;;
    "builds list")     printf "%s\n" "$SIBLINGS" ;;
  esac
  exit 0'

# defers: 0/"defer" when an older sibling wins the lock, "proceed" when this build is earliest.
_defers() { if ds_older_autosuspend_build_running reg proj trig self >/dev/null 2>&1; then echo defer; else echo proceed; fi; }

@test "tiebreak: an older sibling → defer" {
  export SELF_CREATED="2026-07-06T02:00:05Z" SIBLINGS="$(printf 'aaaa\t2026-07-06T01:59:29Z')"
  spy_cmd gcloud "$_tiebreak_router"
  assert_equal "$(_defers)" "defer"
}

@test "tiebreak: only a newer sibling → proceed" {
  export SELF_CREATED="2026-07-06T02:00:05Z" SIBLINGS="$(printf 'bbbb\t2026-07-06T02:01:00Z')"
  spy_cmd gcloud "$_tiebreak_router"
  assert_equal "$(_defers)" "proceed"
}

@test "tiebreak: no siblings → proceed" {
  export SELF_CREATED="2026-07-06T02:00:05Z" SIBLINGS=""
  spy_cmd gcloud "$_tiebreak_router"
  assert_equal "$(_defers)" "proceed"
}

@test "tiebreak: mixed siblings (one older) → defer" {
  export SELF_CREATED="2026-07-06T02:00:05Z"
  export SIBLINGS="$(printf 'bbbb\t2026-07-06T02:01:00Z\ncccc\t2026-07-06T01:58:00Z')"
  spy_cmd gcloud "$_tiebreak_router"
  assert_equal "$(_defers)" "defer"
}

@test "tiebreak: exact createTime tie → proceed (a tie is NOT older)" {
  export SELF_CREATED="2026-07-06T02:00:05Z" SIBLINGS="$(printf 'dddd\t2026-07-06T02:00:05Z')"
  spy_cmd gcloud "$_tiebreak_router"
  assert_equal "$(_defers)" "proceed"
}

@test "tiebreak: self createTime unknown (list hiccup) → proceed (fail-open)" {
  export SELF_CREATED="" SIBLINGS="$(printf 'eeee\t2026-07-06T01:00:00Z')"
  spy_cmd gcloud "$_tiebreak_router"
  assert_equal "$(_defers)" "proceed"
}

# ── ds_force_unlock_if_dead — safety gates ───────────────────────────────────────────────────
# Router: `storage cat` → the lock JSON ($LOCKJSON); `storage objects` (describe) → the object
# GENERATION ($LOCKGEN, what force-unlock needs on GCS); `builds list` → ongoing sibling ids
# ($OTHERS). `tofu` is spied separately so we assert whether force-unlock was (or was NOT) invoked
# and WITH WHICH id. rc 0 = "retry" (lock gone or safely broken), rc 1 = "no-op" (live/unparseable).
_ful_router='
  case "$1 $2" in
    "storage cat")     printf "%s" "$LOCKJSON" ;;
    "storage objects") printf "%s\n" "$LOCKGEN" ;;
    "builds list")     printf "%s\n" "$OTHERS" ;;
  esac
  exit 0'

_outcome() { if ds_force_unlock_if_dead reg proj bucket trig self "$LOCK_ID_PY" >/dev/null 2>&1; then echo retry; else echo noop; fi; }

@test "force-unlock: lock already gone → retry, nothing unlocked" {
  export LOCKJSON="" OTHERS=""
  spy_cmd gcloud "$_ful_router"; spy_cmd tofu 'exit 0'
  assert_equal "$(_outcome)" "retry"
  refute_spy_called_with tofu "force-unlock"
}

@test "force-unlock: a sibling build is alive → no-op, live lock NEVER unlocked" {
  export LOCKJSON='{"ID":"123"}' OTHERS="siblingbuild"
  spy_cmd gcloud "$_ful_router"; spy_cmd tofu 'exit 0'
  assert_equal "$(_outcome)" "noop"
  refute_spy_called_with tofu "force-unlock"
}

@test "force-unlock: orphaned lock, no sibling → retry, force-unlocked by the GCS GENERATION" {
  export OTHERS="" LOCKGEN="1783337489797257"; LOCKJSON="$(fixture_contents lock-orphaned.json)"; export LOCKJSON
  spy_cmd gcloud "$_ful_router"; spy_cmd tofu 'exit 0'
  assert_equal "$(_outcome)" "retry"
  # force-unlock MUST use the object generation, NOT the JSON "ID" UUID (GCS rejects the UUID with
  # "Lock ID should be numerical value" — the real incident). Pin the generation, forbid the UUID.
  assert_spy_called_with tofu "force-unlock" "-force" "1783337489797257"
  refute_spy_called_with tofu "ce7ace5f-ada3-25a0-f88a-a7ec9dac342d"
}

@test "force-unlock: parseable lock but generation unreadable → no-op, NOT unlocked" {
  # The JSON parses (a well-formed lock) but `storage objects describe` can't read the generation —
  # recovery must refuse rather than force-unlock with an empty/guessed id.
  export OTHERS="" LOCKGEN=""; LOCKJSON="$(fixture_contents lock-orphaned.json)"; export LOCKJSON
  spy_cmd gcloud "$_ful_router"; spy_cmd tofu 'exit 0'
  assert_equal "$(_outcome)" "noop"
  refute_spy_called_with tofu "force-unlock"
}

@test "force-unlock: unparseable lock ID → no-op, blind lock NEVER unlocked" {
  export LOCKJSON="garbage-not-json" OTHERS=""
  spy_cmd gcloud "$_ful_router"; spy_cmd tofu 'exit 0'
  assert_equal "$(_outcome)" "noop"
  refute_spy_called_with tofu "force-unlock"
}
