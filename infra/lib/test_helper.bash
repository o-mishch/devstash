# shellcheck shell=bash
# The `printf '…'` templates in spy_cmd/fake_cmd emit stub-script SOURCE literally — the single
# quotes are deliberate (we are generating shell code, not expanding here), so SC2016 does not apply.
# shellcheck disable=SC2016
# Shared bats setup for the infra shell tests (state-lock.bats, secrets-guard.bats, and the
# lib/posix/*.bats suites).
# Loads bats-support (run/assert plumbing), bats-assert (assert_success/assert_output/…), and
# bats-mock (stub/unstub with call-plan verification) from the repo's node_modules — the same
# npm devDependencies the rest of the tooling installs, so `npm ci` provisions the test harness
# too (no Homebrew/apt/submodule step). Resolve paths from this file's location so tests can be
# run from any CWD (bats, npm run test:infra, or an IDE).
#
# Fixtures (held-lock JSON, tofu-output payloads) live as real .json files under __fixtures__/ —
# NOT inline heredocs — so each stays diffable/jq-validatable in its own language (see fixture()).

_HELPER_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${_HELPER_DIR}/../.." && pwd)"   # infra/lib/ → repo root (2 up)
# These paths are consumed by the .bats files that `load` this helper (not here) — export marks them
# used for shellcheck and lets them survive into each test's environment.
export RUN_SH="${REPO_ROOT}/infra/run/gcp/run.sh"
export SUSPEND_SH="${REPO_ROOT}/infra/run/gcp/lib/suspend.sh"
export GKE_SH="${REPO_ROOT}/infra/run/gcp/lib/gke.sh"
export RECONCILE_SH="${REPO_ROOT}/infra/run/gcp/lib/reconcile.sh"
export COMMON_SH="${REPO_ROOT}/infra/lib/common.sh"

load "${REPO_ROOT}/node_modules/bats-support/load.bash"
load "${REPO_ROOT}/node_modules/bats-assert/load.bash"
load "${REPO_ROOT}/node_modules/bats-mock/stub.bash"

# ── Per-test stub isolation (CRITICAL — do not remove) ───────────────────────────────────────────
# bats-mock points its PATH bindir at ${BATS_TMPDIR}/bin — and BATS_TMPDIR is a MACHINE-GLOBAL temp
# dir SHARED by every test, every .bats file, and every concurrent `bats` process. bats-mock's own
# stub/unstub clean up after themselves, but our fake_cmd/spy_cmd write executables into that bindir
# and (being non-verified) are never removed. With no teardown the leftover shadows a later test's
# `stub gcloud` on PATH — e.g. state-lock.bats' `not-json-at-all` fake_cmd gcloud leaking into the
# earlier read_tflock test — producing flaky, order- and cross-process-dependent failures.
#
# FIX: repoint the mock bindir at a PER-TEST directory under $BATS_TEST_TMPDIR (bats creates it fresh
# per test and removes it after), and prepend it to PATH ahead of the stale shared one. Every stub /
# fake_cmd / spy_cmd a test installs now lives in that private dir and vanishes when the test ends —
# no cross-test, cross-file, or cross-process (two `bats` runs at once) leakage is possible. This code
# runs at `load` time, i.e. inside each file's setup(), so it re-isolates before every single test.
# (test_helper is loaded from setup(), so $BATS_TEST_TMPDIR is already set here.)
BATS_MOCK_TMPDIR="${BATS_TEST_TMPDIR}/mock"
BATS_MOCK_BINDIR="${BATS_MOCK_TMPDIR}/bin"
mkdir -p "${BATS_MOCK_BINDIR}"
PATH="${BATS_MOCK_BINDIR}:${PATH}"
# Guard against a leftover shared bindir from a crashed/concurrent run: drop the global one bats-mock
# put on PATH at load time so a stale executable there can never be reached ahead of a real command.
PATH="${PATH//${BATS_TMPDIR%/}\/bin:/}"

# Integrity guard for the SHARED bats-mock dispatcher. Every stub/stub_repeated symlinks the command
# to node_modules/bats-mock/binstub — the one plan-matching dispatcher the whole suite depends on. The
# pre-isolation leak above could overwrite it (a leftover `stub tofu` symlink + a later `fake_cmd tofu`
# writing THROUGH it clobbered binstub with a fixture body, silently breaking every stubbed command
# suite-wide). The isolation now prevents that, but a corrupted node_modules from an OLD run — or
# another checkout sharing this node_modules — would still poison the run as inscrutable flakiness.
# Fail LOUD and early instead: the real dispatcher references its plan file; a clobbered copy does not.
if ! grep -q '_STUB_PLAN' "${REPO_ROOT}/node_modules/bats-mock/binstub" 2>/dev/null; then
  printf 'FATAL: node_modules/bats-mock/binstub is corrupted (missing the _STUB_PLAN dispatcher).\n' >&2
  printf '       Restore it with: npm ci  (or reinstall bats-mock). See test_helper.bash isolation notes.\n' >&2
  exit 1
fi

# teardown: bats runs this after each test. $BATS_TEST_TMPDIR (and our per-test mock dir inside it) is
# auto-removed by bats, so this is belt-and-suspenders — it empties the private bindir explicitly so
# even a within-test PATH quirk cannot carry a stub into the next test. No-op if the dir is gone.
teardown() {
  [[ -n "${BATS_MOCK_BINDIR:-}" ]] && rm -rf "${BATS_MOCK_BINDIR}" 2>/dev/null || true
}

# fixture <name>: absolute path to a __fixtures__/<name> file next to the CALLING .bats file
# (BATS_TEST_DIRNAME/__fixtures__), so each test dir owns its own fixtures (run/gcp/lib and
# lib/posix both have one). Keeps tests reading data from segregated files, not inline JSON.
fixture() { printf '%s' "${BATS_TEST_DIRNAME}/__fixtures__/$1"; }

# fixture_contents <name>: the raw bytes of a fixture, for stubs that must echo a payload.
fixture_contents() { cat "$(fixture "$1")"; }

# fake_cmd <name> <body>: drop a NON-verified stub onto the bats-mock PATH bindir (already on
# $PATH via stub.bash). Use this for COLLABORATORS whose exact call pattern the test does not
# assert — commands the code invokes conditionally (gcloud/pgrep/gh on branches a given case may
# skip). bats-mock's stub/unstub is the right tool when you WANT to verify a call happened with
# specific args (e.g. `tofu force-unlock <ID>`); it over-constrains conditionally-invoked commands
# because unstub fails on any unconsumed plan line. This helper fills that gap with a plain script.
# <body> is the stub's shell body (receives "$@"); default: succeed silently.
fake_cmd() {
  local name="$1" body="${2:-exit 0}"
  mkdir -p "${BATS_MOCK_BINDIR}"
  { printf '#!/usr/bin/env bash\n'; printf '%s\n' "$body"; } > "${BATS_MOCK_BINDIR}/${name}"
  chmod +x "${BATS_MOCK_BINDIR}/${name}"
}

# ── Arg-spying stubs (spy_cmd) ───────────────────────────────────────────────────────────────
# bats-mock's stub/unstub verifies a call happened and can MATCH args against a plan, but its plan
# `: command` body cannot see the ACTUAL argv of a call (inspect_args is empty there). So when the
# code calls a collaborator in a LOOP with varying, dynamic args — which zonal NEG + zone was
# deleted, which #generation was pruned — and the test must assert those exact values, bats-mock
# can't express it. spy_cmd is the one reusable pattern for that: it installs a PATH stub that
# RECORDS every invocation's argv (and stdin) to files, then serves scripted output via an optional
# router body. Assertions (assert_spy_called_with / spy_call_count / spy_stdin) read those records.
#
# Use spy_cmd when the TEST ASSERTS DYNAMIC ARGS/VALUES of a call; use bats-mock stub/unstub when a
# static arg pattern + ordered call-count is enough; use fake_cmd for a pure conditional no-op.
#
# spy_cmd <name> [router-body]: install an arg-recording stub for <name>. <router-body> (optional)
# runs AFTER recording, sees the call's "$@", and produces the stub's stdout/exit — typically a
# `case "$1 $2" in …` that serves per-subcommand output (mirrors how real gcloud dispatches). With
# no body the stub just records and exits 0. Records go under $SPY_DIR (per-test, set on first use).
#
# STDIN is NOT drained by default — a spied command run inside a `printf … | while read` loop (the
# common list→delete pattern) shares that pipe as its stdin, so cat-ing it here would swallow the
# loop's remaining rows. Opt in per-command with spy_capture_stdin <name> when the code feeds data
# on stdin (e.g. `gcloud storage rm -I`) AND the test asserts it via spy_stdin.
spy_cmd() {
  local name="$1" router="${2:-}"
  : "${SPY_DIR:=${BATS_TEST_TMPDIR}/spy}"; export SPY_DIR
  mkdir -p "${SPY_DIR}" "${BATS_MOCK_BINDIR}"
  local capture_flag="${SPY_DIR}/${name}.capture_stdin"
  # One record line per call: argv joined by the ASCII Unit Separator (0x1f) so args with spaces stay
  # intact and assert_spy_called_with can match substrings without word-splitting ambiguity.
  {
    printf '#!/usr/bin/env bash\n'
    printf 'SPY_DIR=%q\n' "${SPY_DIR}"
    printf 'name=%q\n' "${name}"
    # Record argv WITHOUT mutating "$@" (no shift) so the router below still sees the original args.
    # Each arg is prefixed with 0x1f; a leading separator on the line is harmless for substring match.
    printf '{ for a in "$@"; do printf "\\037%%s" "$a"; done; printf "\\n"; } >> "${SPY_DIR}/${name}.calls"\n'
    # Only drain stdin when explicitly opted in (marker file present) — see the note above.
    printf 'if [ -e %q ] && [ ! -t 0 ]; then cat >> "${SPY_DIR}/${name}.stdin" 2>/dev/null || true; fi\n' "${capture_flag}"
    printf '%s\n' "${router:-exit 0}"
  } > "${BATS_MOCK_BINDIR}/${name}"
  chmod +x "${BATS_MOCK_BINDIR}/${name}"
}

# spy_capture_stdin <name>: opt <name>'s spy into recording stdin (see spy_cmd's STDIN note). Call
# AFTER spy_cmd <name>. Needed only when the code pipes data into the command and the test asserts
# it via spy_stdin (e.g. the `gcloud storage rm -I` prune path).
spy_capture_stdin() {
  : "${SPY_DIR:=${BATS_TEST_TMPDIR}/spy}"
  mkdir -p "${SPY_DIR}"
  touch "${SPY_DIR}/$1.capture_stdin"
}

# spy_calls <name>: echo the recorded call lines (argv separated by 0x1f within a line). Mostly for
# debugging / custom assertions; prefer the assert_* helpers below.
spy_calls() { cat "${SPY_DIR}/$1.calls" 2>/dev/null || true; }

# spy_call_count <name>: number of times <name> was invoked.
spy_call_count() { grep -c '' "${SPY_DIR}/$1.calls" 2>/dev/null || echo 0; }

# spy_stdin <name>: the concatenated stdin fed to <name> across all calls (for `… rm -I`-style
# stdin-driven commands).
spy_stdin() { cat "${SPY_DIR}/$1.stdin" 2>/dev/null || true; }

# assert_spy_called_with <name> <substr>...: pass iff SOME recorded call's argv contains EVERY given
# substring. Matches within a single call (args are 0x1f-joined per line), so multiple substrings
# assert they co-occurred in the same invocation (e.g. the NEG name AND its --zone).
assert_spy_called_with() {
  local name="$1"; shift
  local line found=1
  # Iterate via spy_calls (tolerates a never-invoked command → empty → no match → the fail below).
  while IFS= read -r line; do
    local ok=0 s
    for s in "$@"; do [[ "$line" == *"$s"* ]] || { ok=1; break; }; done
    if [[ $ok -eq 0 ]]; then found=0; break; fi
  done < <(spy_calls "$name")
  if [[ $found -ne 0 ]]; then
    batslib_print_kv_single 4 "command" "$name" "expected args" "$*" "recorded calls" "$(spy_calls "$name")" \
      | batslib_decorate "spy call with expected args not found" | fail
  fi
}

# refute_spy_called_with <name> <substr>...: the inverse — fail if any call matched all substrings.
# Passes trivially when the command was never invoked (no calls to match).
refute_spy_called_with() {
  local name="$1"; shift
  local line s ok
  while IFS= read -r line; do
    ok=0; for s in "$@"; do [[ "$line" == *"$s"* ]] || { ok=1; break; }; done
    if [[ $ok -eq 0 ]]; then
      batslib_print_kv_single 4 "command" "$name" "forbidden args" "$*" \
        | batslib_decorate "spy was called with forbidden args" | fail
    fi
  done < <(spy_calls "$name")
}
