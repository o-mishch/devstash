#!/usr/bin/env bats
# Tests for wait-secrets-sync.sh's post-timeout classification — the branch that decides whether a
# not-Ready ExternalSecret is a benign suspended/parked env (warn, exit 0, synced=false) or a real
# fault (fail loudly, exit 1). The regression under test: reaching this branch must classify by
# ESO's own `reason=UpdateFailed` Kubernetes Event, NOT by reading devstash-app-config's payload
# directly — the deployer SA that runs this script only holds secretmanager.viewer (list/metadata),
# not secretAccessor, so a payload read always comes back empty regardless of the secret's real state.
#
# We drive the whole script with `run bash <script>` against a stubbed kubectl. `wait` always fails
# (drives every test into the classification tail); `get events` serves the UpdateFailed event
# message under test; `describe` is a no-op fallback for the no-event branch.

setup() {
  load "${BATS_TEST_DIRNAME}/../lib/test_helper"
  export SCRIPT="${REPO_ROOT}/infra/ci/wait-secrets-sync.sh"
  export GCP_PROJECT_ID=proj-x
  export DEVSTASH_NS=devstash
  export GITHUB_OUTPUT="${BATS_TEST_TMPDIR}/gh_output"
  : > "$GITHUB_OUTPUT"
  # Collapse the re-nudge loop to a SINGLE iteration for the failure-classification tests: the
  # stubbed `kubectl wait` returns instantly (no real 30s block), so a 900s budget would spin the
  # loop thousands of times before classifying. Budget 0 = start one iteration, then the deadline
  # check breaks and we fall through to the event classification these tests exercise. Interval kept
  # tiny so any test that DOES let `wait` succeed returns immediately.
  export SECRET_SYNC_TIMEOUT=0
  export SECRET_SYNC_NUDGE_INTERVAL=1
}

# _stub_kubectl <events-message> [events-rc]: `wait` always fails (timeout path). `get events`
# is spied (so tests can assert its exact argv, e.g. the --field-selector/--sort-by/-o flags).
# On success (default events-rc=0) <events-message> is the sole UpdateFailed event's .message on
# stdout (empty means no matching event). On a non-zero events-rc, <events-message> instead goes
# to STDERR — matching real kubectl, which writes its error text there — simulating a genuine
# kubectl failure (RBAC denial, API server unreachable). `describe` is a no-op fallback.
_stub_kubectl() {
  local msg="$1" events_rc="${2:-0}"
  spy_cmd kubectl "
    if [[ \"\$*\" == *' wait '* ]]; then exit 1; fi
    if [[ \"\$*\" == *'get events'* ]]; then
      if [[ ${events_rc} -ne 0 ]]; then printf '%s' '${msg}' >&2; else printf '%s' '${msg}'; fi
      exit ${events_rc}
    fi
    exit 0"
}

@test "wait-secrets-sync: queries UpdateFailed events for the right object, sorted newest-first" {
  _stub_kubectl ""
  run bash "$SCRIPT"
  assert_spy_called_with kubectl "get" "events" "involvedObject.name=devstash-secrets,reason=UpdateFailed" "--sort-by=.lastTimestamp" "-o" "jsonpath={.items[-1:].message}"
}

@test "wait-secrets-sync: no UpdateFailed event → fails loudly, synced=false" {
  _stub_kubectl ""
  run bash "$SCRIPT"
  assert_failure
  assert_output --partial "real error"
  run cat "$GITHUB_OUTPUT"
  refute_output --partial "synced=true"
}

@test "wait-secrets-sync: kubectl get events itself fails → fails loudly with the kubectl error surfaced" {
  _stub_kubectl "connection refused" 1
  run bash "$SCRIPT"
  assert_failure
  assert_output --partial "kubectl get events failed"
  assert_output --partial "connection refused"
}

@test "wait-secrets-sync: UpdateFailed event names a missing infra property → warns, exits 0, synced=false" {
  _stub_kubectl 'key redis-url does not exist in secret devstash-app-config'
  run bash "$SCRIPT"
  assert_success
  assert_output --partial "::warning::"
  run cat "$GITHUB_OUTPUT"
  assert_output --partial "synced=false"
}

@test "wait-secrets-sync: UpdateFailed event for another reason → fails loudly (real error)" {
  _stub_kubectl 'unable to access Secret from SecretManager Client: rpc error: code = PermissionDenied'
  run bash "$SCRIPT"
  assert_failure
  assert_output --partial "real error"
}

# The re-nudge loop re-annotates ESO every iteration, so a version that was DISABLED on the first
# poll but becomes Ready on a later one is caught WITHOUT the operator having to `kubectl annotate`
# by hand (the regression this rewrite fixes). Drive it with a counter file: `wait` fails the first
# time, succeeds the second — proving the loop re-nudged and re-checked rather than blocking once.
@test "wait-secrets-sync: re-nudge loop catches a version that becomes Ready on a later poll (no manual nudge)" {
  export SECRET_SYNC_TIMEOUT=60   # allow a second iteration (budget not yet spent after the first)
  local counter="${BATS_TEST_TMPDIR}/wait_calls"; : > "$counter"
  spy_cmd kubectl "
    if [[ \"\$*\" == *' wait '* ]]; then
      n=\$(wc -l < '${counter}' | tr -d ' '); echo x >> '${counter}'
      if [[ \$n -ge 1 ]]; then exit 0; fi   # Ready on the 2nd wait (after a re-nudge)
      exit 1
    fi
    exit 0"
  run bash "$SCRIPT"
  assert_success
  assert_output --partial "secrets synced"
  # Annotated at least twice — once per loop iteration — proving the continuous re-nudge.
  assert_spy_called_with kubectl "annotate"
  run cat "$GITHUB_OUTPUT"
  assert_output --partial "synced=true"
}

# A DISABLED-version failure that survives the FULL budget is a real fault (no enabled version ever
# materialized), not a transient race the loop can heal — fail loudly, do not green the deploy.
@test "wait-secrets-sync: still DISABLED after the whole budget → fails loudly (no false pass)" {
  _stub_kubectl 'Secret Version [projects/1/secrets/devstash-app-config/versions/2] is in DISABLED state'
  run bash "$SCRIPT"
  assert_failure
  assert_output --partial "stuck on a DISABLED secret version"
  run cat "$GITHUB_OUTPUT"
  refute_output --partial "synced=true"
}
