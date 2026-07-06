#!/usr/bin/env bats
# The upfront intent gates that keep any GCP mutation behind ONE confirmation:
#   _confirm_bringup <up|resume|apply>  (run.sh)      — gates resume/up/apply's staging apply + CI
#                                                        dispatch; sets _BRINGUP_CONFIRMED=1 on accept.
#   _apply_plan's prompt-suppression                  — honours _BRINGUP_CONFIRMED so there is exactly
#                                                        ONE prompt per invocation (no double-ask).
#   _confirm_bootstrap  (lib/bootstrap.sh)            — gates bootstrap's project/billing/bucket/APIs.
#
# run.sh now guards its dispatch `case` behind `[[ "${BASH_SOURCE[0]}" == "${0}" ]]`, so sourcing it
# here defines every function WITHOUT running a command — we drive the gates directly and assert both
# the return code and that the declining path calls NO collaborator (the whole point: nothing touches
# GCP before `y`). `confirm` (common.sh) is the real thing; we feed y/n on stdin or set AUTO_APPROVE.
#
# The gates print a summary that interpolates PROJECT_ID/REGION/STATE_BUCKET (set by ensure_tfvars in
# the real flow, which runs BEFORE the gate). run.sh runs under `set -u`, so the isolated drives here
# export those first — mirroring the post-ensure_tfvars state the gate sees in production.

setup() {
  load "${BATS_TEST_DIRNAME}/../../../lib/test_helper"
  export PROJECT_ID=proj REGION=us-central1 ENVIRONMENT=dev STATE_BUCKET=proj-tfstate-dev
  # Sourcing run.sh pulls in common.sh + every lib and defines _confirm_bringup / _apply_plan /
  # _confirm_bootstrap in this shell. The dispatch guard keeps it from running `up`. ensure_tfvars is
  # NOT called at source time, so no real tfvars is needed.
  source "$RUN_SH"
}

# ── _confirm_bringup ─────────────────────────────────────────────────────────────────────────

@test "_confirm_bringup: decline (n) dies before any mutation" {
  run _confirm_bringup resume <<<"n"
  assert_failure
  assert_output --partial "aborted before any GCP changes"
}

@test "_confirm_bringup: the summary names the phase and lists the staging apply + CI dispatch" {
  run _confirm_bringup apply <<<"n"
  assert_failure
  assert_output --partial "'apply' will provision GCP"
  assert_output --partial "staging apply"
  assert_output --partial "DISPATCH the deploy-gke CI run"
}

@test "_confirm_bringup: accept (y) sets _BRINGUP_CONFIRMED=1" {
  # Drive in THIS shell (not `run`, which subshells) so we can read the exported flag afterwards.
  _confirm_bringup resume <<<"y"
  assert_equal "${_BRINGUP_CONFIRMED:-}" "1"
}

@test "_confirm_bringup: AUTO_APPROVE=1 passes without reading stdin and still sets the flag" {
  unset _BRINGUP_CONFIRMED
  # No stdin provided at all — confirm() must short-circuit on AUTO_APPROVE, never blocking on read.
  AUTO_APPROVE=1 _confirm_bringup up </dev/null
  assert_equal "${_BRINGUP_CONFIRMED:-}" "1"
}

# ── _apply_plan prompt-suppression (the no-double-prompt contract) ────────────────────────────
# Stub `confirm` to RECORD whether it was reached, and neutralise every collaborator _apply_plan
# calls before its prompt into no-ops, so the test isolates the ONE branch we care about: does
# _apply_plan reach confirm or not?

_neutralise_apply_plan_prereqs() {
  ensure_tfvars() { :; }
  _clear_plan_file() { :; }
  require_state_bucket() { :; }
  wait_for_no_autosuspend_build() { :; }
  mark_provisioning() { :; }
  clear_provisioning() { :; }
  reconcile_state() { :; }
  tofu_() { :; }
  _plan_with_refresh_fallback() { :; }
  CONFIRM_CALLS="${BATS_TEST_TMPDIR}/confirm.calls"; : > "$CONFIRM_CALLS"
  confirm() { echo "$*" >> "$CONFIRM_CALLS"; return 0; }
}

@test "_apply_plan: with _BRINGUP_CONFIRMED=1 it does NOT prompt again (no double-ask)" {
  _neutralise_apply_plan_prereqs
  _BRINGUP_CONFIRMED=1 _apply_plan
  # confirm must never have been called — the upfront gate already took the single `y`.
  run cat "$CONFIRM_CALLS"
  assert_output ""
}

@test "_apply_plan: without the flag it keeps the interactive review prompt" {
  _neutralise_apply_plan_prereqs
  unset _BRINGUP_CONFIRMED
  _apply_plan
  # confirm WAS reached exactly once (the standalone-apply review gate is preserved), with the
  # review-prompt text — so the file holds exactly one line, and it is the review prompt.
  run cat "$CONFIRM_CALLS"
  assert_line --index 0 --partial "Apply this plan?"
  assert_equal "${#lines[@]}" "1"
}

# ── _confirm_bootstrap ───────────────────────────────────────────────────────────────────────

@test "_confirm_bootstrap: decline (n) dies before any bootstrap step runs" {
  run _confirm_bootstrap <<<"n"
  assert_failure
  assert_output --partial "aborted before any GCP changes"
}

@test "_confirm_bootstrap: the summary lists project/billing/bucket/APIs" {
  run _confirm_bootstrap <<<"n"
  assert_output --partial "create the GCP project"
  assert_output --partial "LINK a billing account"
  assert_output --partial "state bucket"
  assert_output --partial "enable the required GCP APIs"
}

@test "_confirm_bootstrap: AUTO_APPROVE=1 passes without reading stdin" {
  AUTO_APPROVE=1 run _confirm_bootstrap </dev/null
  assert_success
}

@test "bootstrap: declining the gate performs NONE of its gcloud steps" {
  # Stub gcloud so if any _bootstrap_* step ran it would record a call; the decline must prevent all.
  spy_cmd gcloud
  # ensure_tfvars is a no-op here (vars already exported in setup); bootstrap → _confirm_bootstrap → n.
  ensure_tfvars() { :; }
  run bootstrap <<<"n"
  assert_failure
  assert_output --partial "aborted before any GCP changes"
  assert_equal "$(spy_call_count gcloud)" "0"
}

# ── _staging_apply: plan → print → apply that exact plan (never blind -auto-approve) ──────────
# The pre-apply staging step must PLAN to a file first (so the diff is visible), then apply THAT
# FILE — the plan-first guarantee. We neutralise the prereqs and record every tofu_locked_ call to
# a log, then assert: (1) a `plan -out=<file>` precedes the `apply <file>`, (2) the SAME file is
# applied, and (3) NO `-auto-approve` is ever passed (the old blind-apply regression).

_record_tofu_locked() {
  ensure_tfvars() { :; }
  require_state_bucket() { :; }
  wait_for_no_autosuspend_build() { :; }
  tofu_() { :; }                       # swallow `tofu_ init`
  _clear_staging_plan() { :; }
  TOFU_LOCKED_LOG="${BATS_TEST_TMPDIR}/tofu_locked.log"; : > "$TOFU_LOCKED_LOG"
  # Record the full argv of each tofu_locked_ call, one call per line.
  tofu_locked_() { echo "$*" >> "$TOFU_LOCKED_LOG"; }
}

@test "_staging_apply: plans to a file BEFORE applying it, and applies that same file" {
  _record_tofu_locked
  _staging_apply "test subgraph" -target=module.x.y
  # Line 1 must be the plan-to-file (carrying the -target); line 2 the apply of that same file
  # (the apply consumes the saved plan, so the -target lives on the plan line, not the apply).
  run sed -n 1p "$TOFU_LOCKED_LOG"
  assert_output --partial "plan"
  assert_output --partial "-out=devstash-staging.tfplan"
  assert_output --partial "-target=module.x.y"
  run sed -n 2p "$TOFU_LOCKED_LOG"
  assert_output --partial "apply"
  assert_output --partial "devstash-staging.tfplan"
}

@test "_staging_apply: NEVER passes -auto-approve (the blind-apply regression)" {
  _record_tofu_locked
  _staging_apply "test subgraph" -target=module.x.y
  # No recorded tofu_locked_ invocation may contain -auto-approve — the old blind apply is gone.
  run cat "$TOFU_LOCKED_LOG"
  refute_output --partial "-auto-approve"
}
