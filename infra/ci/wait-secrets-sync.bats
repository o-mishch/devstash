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
}

# _stub_kubectl <events-message>: `wait` always fails (timeout path). `get events` echoes
# <events-message> as the sole UpdateFailed event's .message (empty means no matching event).
# `describe` is a no-op fallback.
_stub_kubectl() {
  local msg="$1"
  fake_cmd kubectl "
    if [[ \"\$*\" == *' wait '* ]]; then exit 1; fi
    if [[ \"\$*\" == *'get events'* ]]; then printf '%s' '${msg}'; exit 0; fi
    exit 0"
}

@test "wait-secrets-sync: no UpdateFailed event → fails loudly, synced=false" {
  _stub_kubectl ""
  run bash "$SCRIPT"
  assert_failure
  assert_output --partial "real error"
  run cat "$GITHUB_OUTPUT"
  refute_output --partial "synced=true"
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

@test "wait-secrets-sync: stuck on DISABLED version → re-nudges and succeeds on retry" {
  fake_cmd kubectl "
    if [[ \"\$*\" == *' wait '* && \"\$*\" == *'--timeout=60s'* ]]; then exit 0; fi
    if [[ \"\$*\" == *' wait '* ]]; then exit 1; fi
    if [[ \"\$*\" == *'get events'* ]]; then printf '%s' 'Secret Version [projects/1/secrets/devstash-app-config/versions/2] is in DISABLED state'; exit 0; fi
    exit 0"
  run bash "$SCRIPT"
  assert_success
  assert_output --partial "Ready after the retry"
  run cat "$GITHUB_OUTPUT"
  assert_output --partial "synced=true"
}

@test "wait-secrets-sync: stuck on DISABLED version → still stuck after retry, fails loudly" {
  _stub_kubectl 'Secret Version [projects/1/secrets/devstash-app-config/versions/2] is in DISABLED state'
  run bash "$SCRIPT"
  assert_failure
  assert_output --partial "still stuck on a DISABLED version"
}
