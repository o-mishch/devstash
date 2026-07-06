#!/usr/bin/env bats
# The empty-state secret-push guard + the outputs-present pre-dispatch gate (run.sh secrets /
# _tf_outputs_present). Reproduces the real incident: a deep-suspended / downed env has 0 tofu
# outputs, and the OLD code piped `tofu output -raw`'s #26991 "No outputs found" warning box into
# `gh … --body`, pushing garbage. The guard must abort BEFORE any gh call on empty state, and push
# the real values on a populated one.
#
# `tofu` (emits `output -json`) and `gh` (logs each push, fails loud on an empty body = a would-be
# interactive prompt) are fake_cmd stubs — we assert the pushed VALUES from a log file, not exact
# call plans. tofu-output payloads live as __fixtures__/*.json (no inline JSON).

setup() {
  load "${BATS_TEST_DIRNAME}/../../../lib/test_helper"
  GH_PUSH_LOG="${BATS_TEST_TMPDIR}/pushes.log"; : > "$GH_PUSH_LOG"; export GH_PUSH_LOG
}

# _stub_secrets_env <outputs-fixture>: fake tofu + gh for a `run.sh secrets` drive.
#   tofu: `output -json` → the fixture's contents; `auth`/anything else → no-op 0.
#   gh:   `auth status` → 0; `secret set`/`variable set` → append name<TAB>body to $GH_PUSH_LOG
#         (empty body ⇒ a would-be interactive prompt ⇒ exit 3 so the regression is caught, not hung);
#         `secret list`/`variable list` → echo the logged names as JSON so the read-back verify sees
#         exactly what was set; everything else no-op.
_stub_secrets_env() {
  local outputs; outputs="$(fixture_contents "$1")"
  fake_cmd tofu "
    for a in \"\$@\"; do [[ \"\$a\" == output ]] && o=1; [[ \"\$a\" == -json ]] && j=1; done
    if [[ -n \"\${o:-}\" && -n \"\${j:-}\" ]]; then cat <<'JSON'
${outputs}
JSON
      exit 0
    fi
    exit 0"
  fake_cmd gh '
    [[ "$1" == auth ]] && exit 0
    if [[ ( "$1" == secret || "$1" == variable ) && "$2" == set ]]; then
      name="$3"; body=""; while [[ $# -gt 0 ]]; do [[ "$1" == --body ]] && { body="$2"; shift; }; shift; done
      [[ -n "$body" ]] || { echo "GH-STUB-ERROR: set $name reached with EMPTY body" >&2; exit 3; }
      printf "%s\t%s\n" "$name" "$body" >> "$GH_PUSH_LOG"; exit 0
    fi
    if [[ ( "$1" == secret || "$1" == variable ) && "$2" == list ]]; then
      q=""; while [[ $# -gt 0 ]]; do [[ "$1" == -q || "$1" == --jq ]] && { q="$2"; shift; }; shift; done
      json=$(jq -Rn "[inputs | split(\"\t\") | {name: .[0], value: .[1]}]" < "$GH_PUSH_LOG")
      if [[ -n "$q" ]]; then printf %s "$json" | jq -r "$q"; else printf %s "$json"; fi; exit 0
    fi
    [[ "$1" == variable && "$2" == delete ]] && exit 0
    exit 0'
}

@test "secrets: empty state aborts before any gh push (no #26991 warning box)" {
  _stub_secrets_env tofu-outputs-empty.json
  AUTO_APPROVE=1 run bash "$RUN_SH" secrets
  assert_failure
  assert_output --partial "tofu output(s) empty"      # descriptive abort message
  refute_output --partial "No outputs found"          # the #26991 box never surfaces
  refute_output --partial "GH-STUB-ERROR"             # gh set never reached with an empty body
  # Nothing pushed: the log file is empty (byte-for-byte).
  [ ! -s "$GH_PUSH_LOG" ]
}

@test "secrets: populated state pushes the real values" {
  _stub_secrets_env tofu-outputs-populated.json
  AUTO_APPROVE=1 run bash "$RUN_SH" secrets
  assert_success
  # name<TAB>value per line in the push log.
  run cat "$GH_PUSH_LOG"
  assert_line --partial "$(printf 'GCP_PROJECT_ID\tproj-x')"
  assert_line --partial "$(printf 'LIFECYCLE_DEPLOYER_SA\tlifecycle@proj.iam')"
  assert_line --partial "$(printf 'APP_DOMAIN\tdevstash.example')"
  refute_line --partial "No outputs found"
}

# ── Unit: the _tf_outputs_present pre-dispatch gate (mirror run.sh's predicate in isolation) ──
# The required-output key set is duplicated from run.sh's SECRETS_REQUIRED_OUTPUTS to exercise the
# predicate without sourcing the whole script; keep it in sync with that array.
_gate_present() {
  local payload="$1"
  local required=(gcp_project_id deployer_service_account_email lifecycle_deployer_service_account_email wif_provider app_domain email_from)
  local name
  for name in "${required[@]}"; do
    [[ -n "$(printf '%s' "$payload" | jq -r --arg k "$name" '(.[$k]?.value // "") | tostring')" ]] || return 1
  done
}

@test "gate: absent on empty state (→ serial fallback)" {
  run _gate_present "$(fixture_contents tofu-outputs-empty.json)"
  assert_failure
}

@test "gate: present on a populated state (→ pre-dispatch overlap)" {
  run _gate_present "$(fixture_contents tofu-outputs-populated.json)"
  assert_success
}

@test "gate: absent on a partial state (some outputs gone)" {
  run _gate_present "$(fixture_contents tofu-outputs-partial.json)"
  assert_failure
}

# ── Regression: _apply_ci_identity's -target list must cover every SA-backed output
# _tf_outputs_present requires ──────────────────────────────────────────────────────────────────
# Hit live 2026-07-06: lifecycle_deployer_service_account_email was added to
# SECRETS_REQUIRED_OUTPUTS (secrets() reads it) without adding module.iam.google_service_account.
# lifecycle_deployer / its WIF binding to _apply_ci_identity's -target list. Result: the
# first-ever/post-down apply path looped forever — _apply_ci_identity "succeeded" with no
# changes, but _tf_outputs_present kept failing on the untargeted output, so
# _apply_with_overlap never reached the full (untargeted) apply. This statically greps run.sh
# for each SA-backed output's backing resource address, so adding a new required output without
# a matching -target fails CI instead of only surfacing as a live hang.
@test "_apply_ci_identity targets every SA-backed output _tf_outputs_present requires" {
  # Each entry is "output-name:resource-address" — the module.iam resource address the output
  # resolves to (see modules/iam/outputs.tf). gcp_project_id/app_domain/email_from are excluded:
  # static vars, no backing resource to target. Parallel-array form (not assoc array) — bats runs
  # this body in a context where `local -A` isn't supported.
  local backing_resources=(
    "deployer_service_account_email:module.iam.google_service_account.deployer"
    "lifecycle_deployer_service_account_email:module.iam.google_service_account.lifecycle_deployer"
    "wif_provider:module.iam.google_iam_workload_identity_pool_provider.github"
  )
  local identity_block
  identity_block="$(awk '/^_apply_ci_identity\(\)/,/^}/' "$RUN_SH")"
  local entry name resource
  for entry in "${backing_resources[@]}"; do
    name="${entry%%:*}"
    resource="${entry#*:}"
    echo "$identity_block" | grep -qF -- "-target=${resource}" \
      || fail "_apply_ci_identity is missing -target=${resource} (backs output '${name}', required by SECRETS_REQUIRED_OUTPUTS)"
  done
}

# ── The AR push target build-push.sh's ds_ar_writable gate waits on ──────────────────────────────
# The AR repo + the deployer's repo-scoped repoAdmin binding are count=environment_active — they
# vanish on suspend and must be recreated BEFORE the pre-dispatched build reaches the registry, or
# the push sits in ds_ar_writable's poll (seen live to attempt 29/40, past the step's 8m retry). The
# shared _AR_PUSH_TARGET_ARGS array is the single source of those two -target addresses; assert it
# names exactly the repo + the deployer binding so a rename in modules/{artifact-registry,iam} that
# isn't mirrored here fails CI instead of silently reintroducing the poll.
@test "the shared AR push-target array targets the repo and the deployer repoAdmin binding" {
  local ar_block
  ar_block="$(awk '/^_AR_PUSH_TARGET_ARGS=\(/,/^\)/' "$RUN_SH")"
  echo "$ar_block" | grep -qF -- "-target=module.artifact_registry.google_artifact_registry_repository.docker" \
    || fail "_AR_PUSH_TARGET_ARGS is missing the AR repo target"
  echo "$ar_block" | grep -qF -- "-target=module.iam.google_artifact_registry_repository_iam_member.deployer_artifact_registry" \
    || fail "_AR_PUSH_TARGET_ARGS is missing the deployer repoAdmin binding target"
}

# The post-suspend FAST path (outputs present) must recreate the AR push target BEFORE it
# pre-dispatches the build — else the build races the still-absent repoAdmin binding. Assert the
# ordering statically: _apply_ar_push_target appears before _predispatch_ci_build in resume()'s
# outputs-present branch. Guards the exact regression that made the push poll to attempt 29/40.
@test "resume fast path recreates the AR push target before pre-dispatching the build" {
  # The shared bring-up tail was extracted into _resume_bringup, so the ordering now lives in TWO
  # places: (a) resume()'s fast branch passes _apply_ar_push_target as the pre-apply, and (b)
  # _resume_bringup runs that pre-apply BEFORE _predispatch_ci_build. Assert both — together they
  # preserve the original "recreate AR push target before dispatching the build" guarantee.
  local resume_block bringup_block preapply_line predispatch_line
  resume_block="$(awk '/^resume\(\)/,/^}/' "$SUSPEND_SH")"
  echo "$resume_block" | grep -qE '^[[:space:]]+_resume_bringup[[:space:]]+_apply_ar_push_target([[:space:]]|$)' \
    || fail "resume()'s fast path no longer passes _apply_ar_push_target to _resume_bringup"

  bringup_block="$(awk '/^_resume_bringup\(\)/,/^}/' "$SUSPEND_SH")"
  # The pre-apply is invoked via the passed function-name variable ("$pre_apply_fn"); assert it runs
  # before _predispatch_ci_build in the shared tail.
  preapply_line="$(echo "$bringup_block" | grep -nE '^[[:space:]]+"\$pre_apply_fn"' | head -1 | cut -d: -f1)"
  predispatch_line="$(echo "$bringup_block" | grep -nE '^[[:space:]]+_predispatch_ci_build([[:space:]]|$)' | head -1 | cut -d: -f1)"
  [[ -n "$preapply_line" ]] || fail "_resume_bringup never invokes the passed pre-apply function"
  [[ -n "$predispatch_line" ]] || fail "_resume_bringup never calls _predispatch_ci_build"
  (( preapply_line < predispatch_line )) \
    || fail "the pre-apply ($preapply_line) must precede _predispatch_ci_build ($predispatch_line) in _resume_bringup"
}

# Recreating the repo/binding is not enough: the repo IAM → registry data-plane propagation can lag
# the pre-apply's return by minutes, so dispatching CI the instant the apply returns races that lag
# against CI's own ds_ar_writable poll (whose wrapping step retry-timeout can fire first, failing the
# build at "attempt 6/40"). Both AR pre-apply helpers must therefore end by calling _wait_ar_push_ready
# — moving that wait onto run.sh's (untimed) clock so CI is dispatched only once the push is usable.
# The apply itself now lives in the shared _staging_apply helper (plan→print→apply), so assert
# _wait_ar_push_ready appears AFTER the _staging_apply call in each helper's body, per helper.
@test "both AR pre-apply helpers gate CI dispatch on _wait_ar_push_ready after applying" {
  local fn block staging_line wait_line
  for fn in _apply_ci_identity _apply_ar_push_target; do
    block="$(awk "/^${fn}\(\) \{/,/^\}/" "$RUN_SH")"
    [[ -n "$block" ]] || fail "run.sh has no ${fn}() definition"
    staging_line="$(echo "$block" | grep -nE '^[[:space:]]+_staging_apply([[:space:]]|$)' | head -1 | cut -d: -f1)"
    wait_line="$(echo "$block" | grep -nE '^[[:space:]]+_wait_ar_push_ready([[:space:]]|$)' | head -1 | cut -d: -f1)"
    [[ -n "$staging_line" ]] || fail "${fn}() no longer calls _staging_apply (the plan→print→apply staging step)"
    [[ -n "$wait_line" ]]    || fail "${fn}() never calls _wait_ar_push_ready — CI dispatch is ungated"
    (( staging_line < wait_line )) \
      || fail "${fn}(): _wait_ar_push_ready ($wait_line) must follow the staging apply ($staging_line)"
  done
}

# The staging applies must NEVER pass -auto-approve — they plan to a file, show it, and apply that
# exact file (via _staging_apply). A regression back to blind `apply -auto-approve <targets>` would
# mutate GCP on an unseen diff, defeating the plan-first gate. Assert no -auto-approve in either helper
# (nor in _staging_apply itself — it applies the SAVED plan, which takes no -auto-approve).
@test "the staging applies never pass -auto-approve (plan-first, no blind apply)" {
  local fn block code
  for fn in _apply_ci_identity _apply_ar_push_target _staging_apply; do
    block="$(awk "/^${fn}\(\) \{/,/^\}/" "$RUN_SH")"
    [[ -n "$block" ]] || fail "run.sh has no ${fn}() definition"
    # Strip comment lines (leading-whitespace '#') so a `-auto-approve` mentioned in a comment
    # doesn't false-positive — we assert on actual CODE only.
    code="$(echo "$block" | grep -vE '^[[:space:]]*#')"
    echo "$code" | grep -q -- '-auto-approve' \
      && fail "${fn}() passes -auto-approve — the staging apply must plan→show→apply the saved plan instead"
  done
  return 0
}
