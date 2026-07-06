#!/usr/bin/env bats
# down()'s self-healing branches, added after a live 2026-07-06 incident where a plain `run.sh down`
# reported "destroyed." while GKE (and everything else) actually survived:
#
#   1. _reconcile_deletion_protection — a Cloud SQL instance adopted earlier via reconcile.sh's
#      `_reconcile_adopt` (plain `tofu import`) kept deletion_protection=true in STATE (import
#      records the provider's live/default value, not config's false), and down()'s destroy runs
#      with -refresh=false so nothing ever reconciled it. `tofu destroy` refused outright. Fixed by
#      a targeted apply, config-driven, run BEFORE the real destroy.
#   2. _shelve_protected_secrets / _restore_protected_secrets — down() used to preserve
#      app_config/ops_config across a teardown via `-exclude`. CONFIRMED LIVE: passing 2+ `-exclude`
#      flags to `tofu destroy` together makes OpenTofu 1.12.3 silently report "No changes" for the
#      ENTIRE plan, even though dozens of real resources (GKE included) are still destroyable — this
#      is how GKE survived a `down` that reported success. The fix removes the two secrets from
#      STATE ONLY (their GCP objects are never touched) before a destroy with ZERO -exclude flags
#      (proven reliable), then re-imports them afterward.
#   3. The PSC-connections destroy retry — the Memorystore service-connection-policy 400'd "still
#      has N PSC Connections associated with it" for several minutes AFTER the Memorystore instance's
#      own destroy had already completed (GCP's async detach lagging behind). There is no gcloud
#      --force for this and Google's docs warn against deleting the underlying forwarding-rules
#      directly, so down() only offers an interactive wait-and-retry (or an explicitly-unsafe manual
#      option) — never a silent auto-retry of a destructive command.
#   4. _reap_stranded_router — an out-of-band Cloud Router+NAT (untracked in state, still live in
#      GCP from an earlier partial teardown cycle) blocked the VPC delete. down() now deletes it
#      directly, existence-gated, before the VPC would be reached.
#
# suspend.sh is sourced via the whole run.sh (its dispatch guard keeps the case/main from running),
# exactly like bringup-gate.bats — this exercises the REAL function bodies, not copies that could
# drift. tofu_/tofu_locked_/confirm/gcloud are overridden per-test so no real tofu/GCS backend or
# gcloud call is ever reached.

setup() {
  load "${BATS_TEST_DIRNAME}/../../../lib/test_helper"
  export PROJECT_ID=proj REGION=us-central1 ENVIRONMENT=dev STATE_BUCKET=proj-tfstate-dev
  source "$RUN_SH"
  # Neutralise the teardown collaborators down() calls around the destroy — not under test here;
  # a bucket/PSA/NEG failure must never mask the branches this file actually exercises.
  # shellcheck disable=SC2317
  ensure_tfvars() { :; }
  # shellcheck disable=SC2317
  empty_bucket() { :; }
  # shellcheck disable=SC2317
  cleanup_leaked_negs() { :; }
  # shellcheck disable=SC2317
  force_release_psa() { :; }
  # shellcheck disable=SC2317
  tf_out() { :; }
  # shellcheck disable=SC2317
  gcloud() { return 1; }  # default: every gcloud probe (router describe, secrets list) "absent"
}

# _neutralise_reconcile_deletion_protection: for the down()-driving tests below (not this
# function's own unit tests, further up), _reconcile_deletion_protection is not what's under test —
# stub it to a no-op so its own tofu_ state show calls can't interfere with the destroy-flow stubs.
_neutralise_reconcile_deletion_protection() {
  # shellcheck disable=SC2317
  _reconcile_deletion_protection() { :; }
}

# ── _psc_connections_still_attached: pure string match, no stubbing needed ──────────────────────

@test "_psc_connections_still_attached: matches the real GCP error text" {
  run _psc_connections_still_attached 'Error: Error when reading or editing ServiceConnectionPolicy: googleapi: Error 400: Cannot delete ServiceConnectionPolicy projects/p/locations/us-central1/serviceConnectionPolicies/devstash-dev-memorystore-psc because it still has 2 PSC Connections associated with it: failed precondition'
  assert_success
}

@test "_psc_connections_still_attached: rejects an unrelated destroy failure" {
  run _psc_connections_still_attached 'Error: failed to delete instance because deletion_protection is set to true. Set it to false to proceed with instance deletion'
  assert_failure
}

@test "_psc_connections_still_attached: rejects empty input" {
  run _psc_connections_still_attached ''
  assert_failure
}

# ── _reconcile_deletion_protection (real body — the setup() override above is per-down() tests) ──

# _stub_state_show <addr:deletion_protection-line;...>: fake `tofu_` so `state show <addr>` prints
# a single `deletion_protection = <bool>` line for addresses in the map, and fails (empty, non-zero)
# for any address NOT listed — reproducing "absent from state" without a real backend.
_stub_state_show() {
  # NOT `local` — tofu_() is a closure invoked later from the caller's own call stack, after this
  # function has returned, so a `local` here would already be out of scope by then (see the
  # identical note on _STUB_FIRST_OUTPUT in _stub_destroy_sequence, further down this file).
  _STUB_PAIRS="$1"
  # shellcheck disable=SC2317
  tofu_() {
    if [[ "$1" == state && "$2" == show ]]; then
      local addr="$3" pair a v
      IFS=';' read -ra _pairs <<<"$_STUB_PAIRS"
      for pair in "${_pairs[@]}"; do
        a="${pair%%=*}"; v="${pair#*=}"
        if [[ "$a" == "$addr" ]]; then
          printf '    deletion_protection = %s\n' "$v"
          return 0
        fi
      done
      return 1
    fi
    return 0
  }
}

@test "_reconcile_deletion_protection: corrects Cloud SQL when state has deletion_protection=true" {
  _stub_state_show 'module.cloudsql.google_sql_database_instance.postgres[0]=true'
  APPLY_LOG="${BATS_TEST_TMPDIR}/apply.log"; : > "$APPLY_LOG"
  # shellcheck disable=SC2317
  tofu_locked_() { echo "$*" >> "$APPLY_LOG"; return 0; }
  run _reconcile_deletion_protection
  assert_success
  assert_output --partial "module.cloudsql.google_sql_database_instance.postgres[0] has deletion_protection=true"
  run cat "$APPLY_LOG"
  assert_line --partial "apply -auto-approve -refresh=false -target=module.cloudsql.google_sql_database_instance.postgres[0]"
  refute_line --partial "google_container_cluster"
}

@test "_reconcile_deletion_protection: leaves GKE alone when its state already says false" {
  _stub_state_show 'module.gke.google_container_cluster.primary[0]=false'
  APPLY_LOG="${BATS_TEST_TMPDIR}/apply.log"; : > "$APPLY_LOG"
  # shellcheck disable=SC2317
  tofu_locked_() { echo "$*" >> "$APPLY_LOG"; return 0; }
  run _reconcile_deletion_protection
  assert_success
  [ ! -s "$APPLY_LOG" ]
}

@test "_reconcile_deletion_protection: skips (does not abort) an address absent from state" {
  # Neither address appears in state at all. Under this script's set -euo pipefail, an unguarded
  # `state show | sed | head` would abort the whole function; the `|| true` guard must keep it a
  # clean skip instead.
  _stub_state_show ''
  APPLY_LOG="${BATS_TEST_TMPDIR}/apply.log"; : > "$APPLY_LOG"
  # shellcheck disable=SC2317
  tofu_locked_() { echo "$*" >> "$APPLY_LOG"; return 0; }
  run _reconcile_deletion_protection
  assert_success
  [ ! -s "$APPLY_LOG" ]
}

@test "_reconcile_deletion_protection: a failed correction warns but does not abort the function" {
  _stub_state_show 'module.cloudsql.google_sql_database_instance.postgres[0]=true'
  # shellcheck disable=SC2317
  tofu_locked_() { return 1; }
  run _reconcile_deletion_protection
  assert_success
  assert_output --partial "could not pre-correct deletion_protection"
}

# ── _shelve_protected_secrets / _restore_protected_secrets ──────────────────────────────────────

@test "_shelve_protected_secrets: state-rm's every address that is present, skips absent ones" {
  # 3 of the 5 addresses "present" (state show succeeds), 2 absent.
  # shellcheck disable=SC2317
  tofu_() {
    if [[ "$1" == state && "$2" == show ]]; then
      case "$3" in
        module.iam.google_secret_manager_secret.app_config) return 0 ;;
        module.iam.google_secret_manager_secret_version.app_config) return 0 ;;
        google_secret_manager_secret.ops_config) return 0 ;;
        *) return 1 ;;
      esac
    fi
    return 0
  }
  RM_LOG="${BATS_TEST_TMPDIR}/rm.log"; : > "$RM_LOG"
  # shellcheck disable=SC2317
  tofu_locked_() { echo "$*" >> "$RM_LOG"; return 0; }
  run _shelve_protected_secrets
  assert_success
  run cat "$RM_LOG"
  assert_line --partial "state rm module.iam.google_secret_manager_secret.app_config"
  assert_line --partial "state rm module.iam.google_secret_manager_secret_version.app_config"
  assert_line --partial "state rm google_secret_manager_secret.ops_config"
  refute_line --partial "google_secret_manager_secret_iam_member.app_access"
  refute_line --partial "ops_config[0]"
}

@test "_shelve_protected_secrets: a failed state rm warns but does not abort (other addresses still processed)" {
  # shellcheck disable=SC2317
  tofu_() { [[ "$1" == state && "$2" == show ]] && return 0; return 0; }  # all 5 present
  # shellcheck disable=SC2317
  tofu_locked_() { [[ "$3" == module.iam.google_secret_manager_secret.app_config ]] && return 1; return 0; }
  run _shelve_protected_secrets
  assert_success
  assert_output --partial "could not shelve module.iam.google_secret_manager_secret.app_config"
}

@test "_restore_protected_secrets: re-imports the secret, its newest ENABLED version, and the IAM member" {
  # shellcheck disable=SC2317
  gcloud() {
    if [[ "$1" == secrets && "$2" == versions && "$3" == list ]]; then
      case "$4" in
        devstash-app-config) echo "14"; return 0 ;;
        devstash-ops-config) echo "3"; return 0 ;;
      esac
    fi
    return 1
  }
  # shellcheck disable=SC2317
  tf_out() { [[ "$1" == app_service_account_email ]] && echo "devstash-app@proj.iam.gserviceaccount.com"; }
  IMPORT_LOG="${BATS_TEST_TMPDIR}/import.log"; : > "$IMPORT_LOG"
  # shellcheck disable=SC2317
  tofu_locked_() { echo "$*" >> "$IMPORT_LOG"; return 0; }
  run _restore_protected_secrets
  assert_success
  run cat "$IMPORT_LOG"
  assert_line --partial "import module.iam.google_secret_manager_secret.app_config proj/devstash-app-config"
  assert_line --partial "import module.iam.google_secret_manager_secret_version.app_config projects/proj/secrets/devstash-app-config/versions/14"
  assert_line --partial "import module.iam.google_secret_manager_secret_iam_member.app_access projects/proj/secrets/devstash-app-config roles/secretmanager.secretAccessor serviceAccount:devstash-app@proj.iam.gserviceaccount.com"
  assert_line --partial "import google_secret_manager_secret.ops_config proj/devstash-ops-config"
  assert_line --partial "import google_secret_manager_secret_version.ops_config[0] projects/proj/secrets/devstash-ops-config/versions/3"
}

@test "_restore_protected_secrets: no ENABLED version found warns but does not abort or die" {
  # shellcheck disable=SC2317
  gcloud() { return 1; }  # no versions, nothing found
  # shellcheck disable=SC2317
  tf_out() { :; }
  # shellcheck disable=SC2317
  tofu_locked_() { return 0; }
  run _restore_protected_secrets
  assert_success
  assert_output --partial "app_config has no ENABLED version to re-import"
  assert_output --partial "no app_service_account_email output yet"
  assert_output --partial "ops_config has no ENABLED version to re-import"
}

@test "_restore_protected_secrets: a failed re-import warns with the exact manual tofu import command" {
  # shellcheck disable=SC2317
  gcloud() { return 1; }
  # shellcheck disable=SC2317
  tf_out() { :; }
  # shellcheck disable=SC2317
  tofu_locked_() { return 1; }
  run _restore_protected_secrets
  assert_success
  # _reimport_or_warn reconstructs the manual command from the SAME addr+id it imported, with the id
  # quoted (the app_access id contains spaces, so all are quoted uniformly) — no drift possible.
  assert_output --partial 'manual: tofu import module.iam.google_secret_manager_secret.app_config "proj/devstash-app-config"'
  assert_output --partial 'manual: tofu import google_secret_manager_secret.ops_config "proj/devstash-ops-config"'
}

# ── _reap_stranded_router ────────────────────────────────────────────────────────────────────────

@test "_reap_stranded_router: a no-op when the router does not exist in GCP" {
  # shellcheck disable=SC2317
  gcloud() { [[ "$1" == compute && "$2" == routers && "$3" == describe ]] && return 1; return 0; }
  run _reap_stranded_router
  assert_success
  refute_output --partial "deleting it directly"
}

@test "_reap_stranded_router: deletes an untracked-but-live router" {
  DELETE_LOG="${BATS_TEST_TMPDIR}/delete.log"; : > "$DELETE_LOG"
  # shellcheck disable=SC2317
  gcloud() {
    if [[ "$1" == compute && "$2" == routers && "$3" == describe ]]; then return 0; fi
    if [[ "$1" == compute && "$2" == routers && "$3" == delete ]]; then echo "$*" >> "$DELETE_LOG"; return 0; fi
    return 0
  }
  run _reap_stranded_router
  assert_success
  assert_output --partial "devstash-dev-router"
  assert_output --partial "untracked in state"
  run cat "$DELETE_LOG"
  assert_line --partial "compute routers delete devstash-dev-router --region=us-central1 --project=proj --quiet"
}

@test "_reap_stranded_router: a failed delete warns but does not abort" {
  # shellcheck disable=SC2317
  gcloud() {
    if [[ "$1" == compute && "$2" == routers && "$3" == describe ]]; then return 0; fi
    if [[ "$1" == compute && "$2" == routers && "$3" == delete ]]; then return 1; fi
    return 0
  }
  run _reap_stranded_router
  assert_success
  assert_output --partial "could not delete stranded router"
}

# ── down()'s destroy retry loop around the PSC-connections error, and its NO -exclude flags ─────

# _stub_destroy_sequence <first-call-failure-output>: fake tofu_/tofu_locked_ so `tofu_ init`
# no-ops (down() calls it for real before the destroy loop) and tofu_locked_'s FIRST `destroy` call
# returns the given failure output (empty string = succeeds immediately), and every call after that
# succeeds — models "the PSC lag clears on retry". A call counter file lets tests assert exactly how
# many attempts were made. Also neutralises the OTHER down() helpers (_reconcile_deletion_protection,
# _shelve_protected_secrets, _restore_protected_secrets, _reap_stranded_router, force_release_psa) —
# this section's tests are about the destroy retry loop itself, not those collaborators.
_stub_destroy_sequence() {
  # NOT `local` — tofu_locked_ below is a closure invoked later from down()'s own call stack, well
  # after this function has returned, so a `local` here would already be out of scope (unbound
  # under set -u) by the time the closure reads it. Must be a plain (function-global) variable.
  _STUB_FIRST_OUTPUT="$1"
  DESTROY_ATTEMPTS="${BATS_TEST_TMPDIR}/destroy_attempts"; : > "$DESTROY_ATTEMPTS"
  # shellcheck disable=SC2317
  tofu_() { :; }  # down()'s `tofu_ init -backend-config=...` call
  # shellcheck disable=SC2317
  tofu_locked_() {
    [[ "$1" == destroy ]] || return 0  # only the real destroy call is under test here
    echo "$*" >> "$DESTROY_ATTEMPTS"
    if [[ "$(wc -l < "$DESTROY_ATTEMPTS")" -eq 1 && -n "$_STUB_FIRST_OUTPUT" ]]; then
      printf '%s\n' "$_STUB_FIRST_OUTPUT"
      return 1
    fi
    return 0
  }
  _neutralise_reconcile_deletion_protection
  # shellcheck disable=SC2317
  _shelve_protected_secrets() { :; }
  # shellcheck disable=SC2317
  _restore_protected_secrets() { :; }
  # shellcheck disable=SC2317
  _reap_stranded_router() { :; }
}

@test "down: a PSC-connections destroy failure, confirmed retry, succeeds on the second attempt" {
  _stub_destroy_sequence 'Error: Error when reading or editing ServiceConnectionPolicy: googleapi: Error 400: Cannot delete ServiceConnectionPolicy projects/p/locations/us-central1/serviceConnectionPolicies/devstash-dev-memorystore-psc because it still has 2 PSC Connections associated with it: failed precondition'
  # shellcheck disable=SC2317
  sleep() { :; }  # skip the real 60s wait in the test
  CONFIRM_CALLS="${BATS_TEST_TMPDIR}/confirm.calls"; : > "$CONFIRM_CALLS"
  # shellcheck disable=SC2317
  confirm() { echo "$*" >> "$CONFIRM_CALLS"; [[ "$1" == "Wait ~60s"* || "$1" == "FORCE-destroy"* ]]; }
  AUTO_APPROVE=0 run down
  assert_success
  assert_output --partial "still shows attached connections"
  assert_output --partial "destroyed."
  [[ "$(wc -l < "$DESTROY_ATTEMPTS")" -eq 2 ]] || fail "expected exactly 2 destroy attempts, got $(wc -l < "$DESTROY_ATTEMPTS")"
  run cat "$CONFIRM_CALLS"
  assert_line --partial "Wait ~60s"
  refute_line --partial "delete those forwarding-rules"
}

@test "down: declining the PSC retry AND the unsafe manual option aborts (no infinite loop)" {
  _stub_destroy_sequence 'Error: Error when reading or editing ServiceConnectionPolicy: googleapi: Error 400: Cannot delete ServiceConnectionPolicy projects/p/locations/us-central1/serviceConnectionPolicies/devstash-dev-memorystore-psc because it still has 2 PSC Connections associated with it: failed precondition'
  CONFIRM_CALLS="${BATS_TEST_TMPDIR}/confirm.calls"; : > "$CONFIRM_CALLS"
  # shellcheck disable=SC2317
  confirm() {
    echo "$*" >> "$CONFIRM_CALLS"
    [[ "$1" == "FORCE-destroy"* ]]  # accept the upfront gate, decline every retry/unsafe prompt after
  }
  AUTO_APPROVE=0 run down
  assert_failure
  [[ "$(wc -l < "$DESTROY_ATTEMPTS")" -eq 1 ]] || fail "expected exactly 1 destroy attempt (no retry after decline), got $(wc -l < "$DESTROY_ATTEMPTS")"
}

@test "down: a non-PSC destroy failure dies immediately, no retry offered" {
  _stub_destroy_sequence 'Error: failed to delete instance because deletion_protection is set to true. Set it to false to proceed with instance deletion'
  CONFIRM_CALLS="${BATS_TEST_TMPDIR}/confirm.calls"; : > "$CONFIRM_CALLS"
  # shellcheck disable=SC2317
  confirm() { echo "$*" >> "$CONFIRM_CALLS"; return 0; }
  AUTO_APPROVE=1 run down
  assert_failure
  assert_output --partial "tofu destroy failed"
  [[ "$(wc -l < "$DESTROY_ATTEMPTS")" -eq 1 ]] || fail "expected exactly 1 destroy attempt (no retry for a non-PSC error), got $(wc -l < "$DESTROY_ATTEMPTS")"
  run cat "$CONFIRM_CALLS"
  refute_line --partial "still shows attached connections"
}

@test "down: the real destroy call never passes any -exclude flag (the whole point of the redesign)" {
  # Regression guard: a future edit that reintroduces -exclude on this call must fail loudly, since
  # 2+ -exclude flags together silently no-op the entire destroy (confirmed live, 2026-07-06).
  local down_block
  down_block="$(awk '/^down\(\) \{/,/^\}/' "$SUSPEND_SH")"
  local code
  code="$(echo "$down_block" | grep -vE '^[[:space:]]*#')"
  echo "$code" | grep -q -- '-exclude' \
    && fail "down() passes -exclude to a tofu command — this reintroduces the confirmed multi-exclude bug; use _shelve_protected_secrets/_restore_protected_secrets instead"
  return 0
}

@test "down: shelves the protected secrets before destroying and restores them after success" {
  _stub_destroy_sequence ''  # succeeds on the first attempt (no error text to match)
  SHELVE_LOG="${BATS_TEST_TMPDIR}/shelve.log"
  RESTORE_LOG="${BATS_TEST_TMPDIR}/restore.log"
  # shellcheck disable=SC2317
  _shelve_protected_secrets() { echo called >> "$SHELVE_LOG"; }
  # shellcheck disable=SC2317
  _restore_protected_secrets() { echo called >> "$RESTORE_LOG"; }
  AUTO_APPROVE=1 run down
  assert_success
  [ -f "$SHELVE_LOG" ] || fail "_shelve_protected_secrets was never called"
  [ -f "$RESTORE_LOG" ] || fail "_restore_protected_secrets was never called"
}

@test "down: restores the shelved secrets even when the destroy ultimately fails (die path)" {
  _stub_destroy_sequence 'Error: failed to delete instance because deletion_protection is set to true. Set it to false to proceed with instance deletion'
  RESTORE_LOG="${BATS_TEST_TMPDIR}/restore.log"
  # shellcheck disable=SC2317
  _restore_protected_secrets() { echo called >> "$RESTORE_LOG"; }
  AUTO_APPROVE=1 run down
  assert_failure
  [ -f "$RESTORE_LOG" ] || fail "_restore_protected_secrets must run even when the destroy dies, so the secrets are never left permanently unshelved"
}

# Regression (found in code review, 2026-07-06): _restore_protected_secrets originally assigned
# `app_config_ver="$(gcloud ... )"` with NO `|| true` guard. bats' `run` wraps the command in its
# own subshell/trap machinery, which happened to mask this — every test above passed even with the
# bug present. The real failure mode only appears when `set -e` propagates exactly as it does for a
# genuine `bash run.sh down` invocation: a plain nested `bash -c` subprocess (NOT bats' `run`) is
# the faithful reproduction, because it exercises `set -e` the same way production does with no
# bats scaffolding in between. This test drives `down()` that way so a future re-introduction of an
# unguarded `gcloud`/`tofu_` substitution anywhere in the function is caught by an aborted (non-
# zero, but silent — no "destroyed." line) run instead of slipping past every `run`-wrapped test.
@test "down: an unversioned/never-provisioned secret does not silently kill the whole script (set -e regression)" {
  local out
  out="$(
    export PROJECT_ID=proj REGION=us-central1 ENVIRONMENT=dev STATE_BUCKET=proj-tfstate-dev AUTO_APPROVE=1
    source "$RUN_SH"
    ensure_tfvars() { :; }
    empty_bucket() { :; }
    cleanup_leaked_negs() { :; }
    force_release_psa() { :; }
    tf_out() { :; }
    _reconcile_deletion_protection() { :; }
    _shelve_protected_secrets() { :; }
    _reap_stranded_router() { :; }
    tofu_() { :; }
    tofu_locked_() { [[ "$1" == destroy ]] && return 0; return 0; }
    # The exact failure signature: gcloud returns non-zero because the secret genuinely has no
    # version yet — this must NOT kill the script via an unguarded `set -e` command substitution.
    gcloud() { return 1; }
    confirm() { return 0; }
    down
  2>&1)"
  local rc=$?
  [[ $rc -eq 0 ]] || fail "down() exited $rc instead of 0 — a secrets-restore probe returning non-zero must not abort the whole teardown. Output was: $out"
  [[ "$out" == *"destroyed."* ]] || fail "down() did not reach its final success message — it likely died silently mid-restore. Output was: $out"
}

# ── _resume_bringup: the CI-overlapped tail shared by resume's two branches. Extracted so the
# only per-branch difference — which pre-apply staging step runs — is a passed-in function name.
# Drive it with all four collaborators stubbed to log their call, and assert the ORDER: pre-apply
# first, then predispatch → arm-trap → the joined apply/restore driver. resume itself is otherwise
# untested, so this pins the seam its two branches share. ──
@test "_resume_bringup: runs the passed pre-apply first, then predispatch → arm-trap → apply-driver" {
  local calls="${BATS_TEST_TMPDIR}/bringup-calls"; : > "$calls"
  # shellcheck disable=SC2317
  _apply_ar_push_target() { echo "pre:ar" >> "$calls"; }
  # shellcheck disable=SC2317
  _apply_ci_identity() { echo "pre:identity" >> "$calls"; }
  # shellcheck disable=SC2317
  _predispatch_ci_build() { echo "predispatch" >> "$calls"; }
  # shellcheck disable=SC2317
  _arm_ci_cancel_trap() { echo "arm:$1" >> "$calls"; }
  # shellcheck disable=SC2317
  _apply_and_wire_cluster_overlapped() { echo "apply-driver" >> "$calls"; }

  # Fast branch → the AR-only pre-apply.
  _resume_bringup _apply_ar_push_target
  run cat "$calls"
  assert_line --index 0 "pre:ar"
  assert_line --index 1 "predispatch"
  assert_line --index 2 "arm:resume"
  assert_line --index 3 "apply-driver"

  # Overlap branch → the full WIF-identity pre-apply, same tail order.
  : > "$calls"
  _resume_bringup _apply_ci_identity
  run cat "$calls"
  assert_line --index 0 "pre:identity"
  assert_line --index 1 "predispatch"
  assert_line --index 2 "arm:resume"
  assert_line --index 3 "apply-driver"
}
