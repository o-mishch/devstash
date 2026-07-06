#!/usr/bin/env bash
# Self-contained, dependency-free test for the SHARED auto-suspend state-lock contention helpers
# (lock-contention.sh): ds_older_autosuspend_build_running (layer-1 dedup tiebreak) and
# ds_force_unlock_if_dead (layer-3 guarded force-unlock). No bats/framework — same posture as
# reap-negs.test.sh / secrets-guard.test.sh. Run directly:
#   bash infra/lib/posix/lock-contention.test.sh
#
# Strategy: source lock-contention.sh, stub `gcloud` (and `tofu`) as shell functions that serve
# scripted `builds describe` / `builds list` / `storage cat` output driven by test globals. The two
# fragile parts are (a) the createTime tiebreak — including the exact-tie boundary that must NOT
# defer — and (b) the force-unlock safety gates that must NEVER break a live or unparseable lock.
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
LOCKID_PY="$REPO_ROOT/infra/terraform/envs/dev/scripts/auto-suspend-lock-id.py"
# shellcheck source=infra/lib/posix/lock-contention.sh
source "$REPO_ROOT/infra/lib/posix/lock-contention.sh"

PASS=0; FAIL=0
ok()  { printf '  \033[0;32m✓\033[0m %s\n' "$1"; PASS=$((PASS + 1)); }
bad() { printf '  \033[0;31m✗\033[0m %s\n' "$1"; FAIL=$((FAIL + 1)); }
eq() { if [[ "$2" == "$3" ]]; then ok "$1"; else bad "$1 (want '$3' got '$2')"; fi; }

# ── ds_older_autosuspend_build_running ───────────────────────────────────────
# Stub: `builds describe` returns SELF_CREATED; `builds list` returns SIBLINGS (id<TAB>createTime
# rows). "defer" == rc 0 (an older sibling wins the lock), "proceed" == rc 1 (this build is earliest).
SELF_CREATED=""; SIBLINGS=""
gcloud() {
  case "$*" in
    *"builds describe"*) printf '%s\n' "$SELF_CREATED" ;;
    *"builds list"*)     printf '%s\n' "$SIBLINGS" ;;
  esac
  return 0
}
defers() { if ds_older_autosuspend_build_running reg proj trig self >/dev/null 2>&1; then echo defer; else echo proceed; fi; }

echo "ds_older_autosuspend_build_running — createTime tiebreak:"
SELF_CREATED="2026-07-06T02:00:05Z"
SIBLINGS="$(printf 'aaaa\t2026-07-06T01:59:29Z\n')";                       eq "older sibling → defer"        "$(defers)" "defer"
SIBLINGS="$(printf 'bbbb\t2026-07-06T02:01:00Z\n')";                       eq "only newer sibling → proceed" "$(defers)" "proceed"
SIBLINGS="";                                                               eq "no siblings → proceed"        "$(defers)" "proceed"
SIBLINGS="$(printf 'bbbb\t2026-07-06T02:01:00Z\ncccc\t2026-07-06T01:58:00Z\n')"; eq "mixed (one older) → defer"    "$(defers)" "defer"
SIBLINGS="$(printf 'dddd\t2026-07-06T02:00:05Z\n')";                       eq "exact-tie → proceed (not older)" "$(defers)" "proceed"
# Fail-open: a describe/list hiccup must not wrongly defer (would skip a needed suspend).
SELF_CREATED=""; SIBLINGS="$(printf 'eeee\t2026-07-06T01:00:00Z\n')";      eq "self createTime unknown → proceed" "$(defers)" "proceed"

# ── ds_force_unlock_if_dead ──────────────────────────────────────────────────
# Stub: `storage cat` returns LOCKJSON; `builds list --ongoing` returns OTHERS; `tofu force-unlock`
# records to $UNLOCK_LOG. rc 0 == "retry" (lock gone or safely broken), rc 1 == "no-op"
# (live/unparseable — must NOT break). The unlock flag goes to a FILE, not a var: outcome() runs the
# helper in a command-substitution subshell, so a stub's var assignment would not survive — the same
# file-based recording reap-negs.test.sh uses.
LOCKJSON=""; OTHERS=""; UNLOCK_LOG="$(mktemp)"
gcloud() {
  case "$*" in
    *"storage cat"*) printf '%s' "$LOCKJSON" ;;
    *"builds list"*) printf '%s\n' "$OTHERS" ;;
  esac
  return 0
}
tofu() { echo "unlocked" >> "$UNLOCK_LOG"; }   # only reached by the orphan-lock branch
outcome() { if ds_force_unlock_if_dead reg proj bucket trig self "$LOCKID_PY" >/dev/null 2>&1; then echo retry; else echo noop; fi; }
unlocked() { if [[ -s "$UNLOCK_LOG" ]]; then echo yes; else echo ""; fi; }

echo "ds_force_unlock_if_dead — safety gates:"
LOCKJSON=""; OTHERS=""; : > "$UNLOCK_LOG";               eq "lock already gone → retry"      "$(outcome)" "retry"
                                                         eq "  …and no unlock attempted"      "$(unlocked)" ""
LOCKJSON='{"ID":"123"}'; OTHERS="siblingbuild"; : > "$UNLOCK_LOG"; eq "sibling alive → no-op" "$(outcome)" "noop"
                                                         eq "  …live lock NEVER unlocked"     "$(unlocked)" ""
LOCKJSON='{"ID":"999888"}'; OTHERS=""; : > "$UNLOCK_LOG"; eq "orphaned lock, no sibling → retry" "$(outcome)" "retry"
                                                         eq "  …orphan WAS force-unlocked"    "$(unlocked)" "yes"
LOCKJSON='garbage'; OTHERS=""; : > "$UNLOCK_LOG";        eq "unparseable ID → no-op"          "$(outcome)" "noop"
                                                         eq "  …blind lock NEVER unlocked"    "$(unlocked)" ""
rm -f "$UNLOCK_LOG"

echo
if [[ $FAIL -eq 0 ]]; then
  printf '\033[0;32mALL %d PASSED\033[0m\n' "$PASS"; exit 0
fi
printf '\033[0;31m%d FAILED\033[0m, %d passed\n' "$FAIL" "$PASS"; exit 1
