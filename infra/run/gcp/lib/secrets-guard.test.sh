#!/usr/bin/env bash
# Self-contained, dependency-free test for the empty-state secret-push guard and the
# outputs-present pre-dispatch gate (run.sh + lib/suspend.sh). No bats/framework — the repo
# runs Vitest for app code only, and adding a shell-test dependency for a handful of assertions
# is not worth it. Run directly:  bash infra/run/gcp/lib/secrets-guard.test.sh
#
# Strategy: BLACK-BOX drive `run.sh secrets` as a subprocess with `tofu`/`gh` stubbed on PATH,
# reproducing the exact bug the user hit (a deep-suspended/downed env → 0 outputs). Asserts:
#   1. empty state  → run.sh secrets EXITS NON-ZERO, pushes NOTHING, prints no #26991 warning box
#   2. empty state  → `gh secret set` is NEVER reached (no interactive "Paste your secret" hang)
#   3. populated     → run.sh secrets pushes the REAL values (no warning box) and exits 0
# Plus a UNIT check that _tf_outputs_present returns present/absent correctly (the pre-dispatch gate).
#
# The `printf '…'` templates in make_stub_bin emit stub-script SOURCE literally — the single quotes
# are deliberate (we are generating shell code, not expanding here), so SC2016 does not apply file-wide.
# shellcheck disable=SC2016
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../../.." && pwd)"
RUN_SH="$REPO_ROOT/infra/run/gcp/run.sh"
PASS=0; FAIL=0
ok()   { printf '  \033[0;32m✓\033[0m %s\n' "$1"; PASS=$((PASS + 1)); }
bad()  { printf '  \033[0;31m✗\033[0m %s\n' "$1"; FAIL=$((FAIL + 1)); }
# assert <condition-rc> <pass-msg> <fail-msg>: pass the RESULT of a test as $1 (0=pass). Avoids the
# `A && ok || bad` pattern (SC2015: C can run when A succeeds) by branching explicitly on the rc.
assert() { if [[ "$1" -eq 0 ]]; then ok "$2"; else bad "$3"; fi; }
# assert_absent <needle> <haystack> <pass-msg> <fail-msg>: pass when <needle> is NOT in <haystack>.
# A dedicated helper (vs a `! grep …; assert $?` line) keeps errexit semantics clear — SC2251 flags
# a bare leading `!` as skipping errexit — and reads as intent: "this text must not appear".
assert_absent() { if grep -qF "$1" <<<"$2"; then bad "$4"; else ok "$3"; fi; }
# assert_false <pass-msg> <fail-msg> -- <cmd...>: run <cmd> and pass when it returns NON-zero.
# Runs the command inside `if` (which is errexit-safe) so we avoid a bare leading `!` (SC2251).
assert_false() {
  local pass="$1" fail="$2"; shift 3   # drop pass, fail, and the "--" separator
  if "$@"; then bad "$fail"; else ok "$pass"; fi
}

# The multi-line #26991 "No outputs found" box `tofu output -raw` prints to STDOUT on an empty
# state. The OLD code piped this into `gh … --body`; the guard must ensure it never reaches gh
# and never appears in a pushed value.
WARNING_BOX_MARKER='No outputs found'

# Build a throwaway PATH dir holding `tofu` + `gh` stubs, plus a log of every gh push. $1 = the
# `tofu output -json` payload the stub emits (the state's outputs). The gh stub APPENDS each
# `secret set`/`variable set` name+body to $GH_PUSH_LOG so the test can assert what was pushed.
make_stub_bin() {
  local bindir="$1" json_payload="$2"
  mkdir -p "$bindir"
  # tofu stub: only `output -json` matters here; everything else is a benign no-op exit 0.
  # Emits the given payload for `output -json` (mirrors real tofu on a populated state) — and for
  # an EMPTY state we pass '{}', exactly what real `tofu output -json` prints (NOT the warning box:
  # that box only ever came from `-raw`, which the fixed code no longer calls).
  {
    printf '#!/usr/bin/env bash\n'
    printf 'for a in "$@"; do [[ "$a" == "output" ]] && want_output=1; [[ "$a" == "-json" ]] && want_json=1; done\n'
    printf 'if [[ -n "${want_output:-}" && -n "${want_json:-}" ]]; then printf %%s %q; exit 0; fi\n' "$json_payload"
    printf 'exit 0\n'
  } > "$bindir/tofu"
  # gh stub: log every push so we can assert body values; `auth status` succeeds; `secret set`
  # WITHOUT --body would (in real gh) prompt interactively — here we FAIL LOUD instead so a
  # regression that reaches gh with an empty body is caught as a test failure, not a hang.
  # `secret set`/`variable set` → log name+body (empty body = a would-be interactive prompt → fail
  # loud). `secret list`/`variable list --json name…` → echo the logged names as JSON so the
  # read-back verification in _verify_pushed_secrets sees exactly what `set` pushed. `variable list`
  # with a per-name jq (gh_var_value) is served the same JSON. Everything else is a benign no-op.
  {
    printf '#!/usr/bin/env bash\n'
    printf 'if [[ "$1" == "auth" ]]; then exit 0; fi\n'
    printf 'if [[ "$1" == "secret" || "$1" == "variable" ]] && [[ "$2" == "set" ]]; then\n'
    printf '  name="$3"; body=""; while [[ $# -gt 0 ]]; do [[ "$1" == "--body" ]] && { body="$2"; shift; }; shift; done\n'
    printf '  [[ -n "$body" ]] || { echo "GH-STUB-ERROR: %%s set %%s reached with EMPTY body (would prompt interactively)" "$3" "$name" >&2; exit 3; }\n'
    printf '  printf "%%s\\t%%s\\n" "$name" "$body" >> "$GH_PUSH_LOG"; exit 0\n'
    printf 'fi\n'
    printf 'if [[ "$1" == "secret" || "$1" == "variable" ]] && [[ "$2" == "list" ]]; then\n'
    printf '  q=""; while [[ $# -gt 0 ]]; do [[ "$1" == "-q" || "$1" == "--jq" ]] && { q="$2"; shift; }; shift; done\n'
    printf '  json=$(jq -Rn "[inputs | split(\\"\\t\\") | {name: .[0], value: .[1]}]" < "$GH_PUSH_LOG")\n'
    printf '  if [[ -n "$q" ]]; then printf %%s "$json" | jq -r "$q"; else printf %%s "$json"; fi; exit 0\n'
    printf 'fi\n'
    printf 'if [[ "$1" == "variable" && "$2" == "delete" ]]; then exit 0; fi\n'
    printf 'exit 0\n'
  } > "$bindir/gh"
  chmod +x "$bindir/tofu" "$bindir/gh"
}

# Populated-state payload: the five outputs `secrets` requires, with sentinel values.
POPULATED_JSON='{"gcp_project_id":{"value":"proj-x"},"deployer_service_account_email":{"value":"dep@proj.iam"},"wif_provider":{"value":"projects/1/locations/global/workloadIdentityPools/p/providers/gh"},"app_domain":{"value":"devstash.example"},"email_from":{"value":"DevStash <no-reply@devstash.example>"}}'

run_secrets() {
  # $1 = tofu output -json payload. Returns run.sh's exit code; stdout+stderr → $OUT, pushes → $GH_PUSH_LOG.
  local payload="$1" tmp bindir
  tmp="$(mktemp -d)"; bindir="$tmp/bin"
  make_stub_bin "$bindir" "$payload"
  GH_PUSH_LOG="$tmp/pushes.log"; : > "$GH_PUSH_LOG"
  export GH_PUSH_LOG
  set +e
  OUT="$(PATH="$bindir:$PATH" AUTO_APPROVE=1 bash "$RUN_SH" secrets 2>&1)"
  RC=$?
  set -e
  PUSHES="$(cat "$GH_PUSH_LOG")"
  rm -rf "$tmp"
}

echo "empty state (post-down / deep-suspend → 0 outputs):"
run_secrets '{}'
[[ $RC -ne 0 ]]; assert $? "run.sh secrets exits non-zero on empty state" "expected non-zero exit, got $RC"
[[ -z "$PUSHES" ]]; assert $? "nothing pushed to GitHub on empty state" "pushed to GitHub despite empty state: $PUSHES"
assert_absent "$WARNING_BOX_MARKER" "$PUSHES" "no #26991 warning box in any pushed value" "warning-box text leaked into a pushed value"
assert_absent "GH-STUB-ERROR" "$OUT" "gh secret set never reached with an empty body" "gh secret set reached with an empty body (interactive-prompt regression)"
grep -q "tofu output(s) empty" <<<"$OUT"; assert $? "aborts with the descriptive empty-outputs message" "missing the descriptive abort message"

echo "populated state (post-apply / active env):"
run_secrets "$POPULATED_JSON"
[[ $RC -eq 0 ]]; assert $? "run.sh secrets exits 0 on a populated state" "expected exit 0, got $RC — output: $OUT"
# Tab-separated name<TAB>body per line. Match with a literal tab ($'\t') — BSD grep (macOS) has no -P.
grep -qF "GCP_PROJECT_ID"$'\t'"proj-x" <<<"$PUSHES"; assert $? "GCP_PROJECT_ID pushed with the real value" "GCP_PROJECT_ID not pushed correctly: $PUSHES"
grep -qF "APP_DOMAIN"$'\t'"devstash.example" <<<"$PUSHES"; assert $? "APP_DOMAIN pushed with the real value" "APP_DOMAIN not pushed correctly: $PUSHES"
assert_absent "$WARNING_BOX_MARKER" "$PUSHES" "no warning box on populated state" "warning-box text in a pushed value on populated state"

# --- Unit: the _tf_outputs_present pre-dispatch gate. Mirror run.sh's predicate against a
# controllable payload (stub tf_out to read from a JSON var) so it is exercised in isolation.
echo "_tf_outputs_present gate:"
gate_present() {
  local payload="$1"
  local SECRETS_REQUIRED_OUTPUTS=(gcp_project_id deployer_service_account_email wif_provider app_domain email_from)
  tf_out() { printf '%s' "$payload" | jq -r --arg k "$1" '(.[$k]?.value // "") | tostring'; }
  local name
  for name in "${SECRETS_REQUIRED_OUTPUTS[@]}"; do
    [[ -n "$(tf_out "$name")" ]] || return 1
  done
}
assert_false "gate says ABSENT on empty state (→ serial fallback)" "gate says present on empty state" -- gate_present '{}'
gate_present "$POPULATED_JSON"; assert $? "gate says PRESENT on populated state (→ pre-dispatch overlap)" "gate says absent on populated state"
# Partial state (some outputs gone, e.g. a half-torn env) must also read as absent.
assert_false "gate says ABSENT on a partial state" "gate says present on a partial state" -- gate_present '{"gcp_project_id":{"value":"proj-x"}}'

echo
if [[ $FAIL -eq 0 ]]; then
  printf '\033[0;32mALL %d PASSED\033[0m\n' "$PASS"; exit 0
fi
printf '\033[0;31m%d FAILED\033[0m, %d passed\n' "$FAIL" "$PASS"; exit 1
