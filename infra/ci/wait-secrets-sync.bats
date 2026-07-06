#!/usr/bin/env bats
# Tests for wait-secrets-sync.sh's post-timeout classification — the branch that decides whether a
# not-Ready ExternalSecret is a benign suspended/parked env (warn, exit 0, synced=false) or a real
# fault (fail loudly, exit 1). The regression under test: an EMPTY source blob (no ENABLED version)
# must now FAIL the build instead of silently finishing green (which previously masked an outage).
#
# We drive the whole script with `run bash <script>` against stubbed kubectl + gcloud. kubectl
# `wait` is stubbed to FAIL (timeout) so every test exercises the classification tail; the `describe`
# fallback is a no-op. gcloud serves the blob read (ds_access_secret_blob → versions list + access).

setup() {
  load "${BATS_TEST_DIRNAME}/../lib/test_helper"
  export SCRIPT="${REPO_ROOT}/infra/ci/wait-secrets-sync.sh"
  export GCP_PROJECT_ID=proj-x
  export DEVSTASH_NS=devstash
  export GITHUB_OUTPUT="${BATS_TEST_TMPDIR}/gh_output"
  : > "$GITHUB_OUTPUT"
}

# _stub_eso <blob-json>: kubectl wait always fails (drives the timeout path); gcloud serves
# <blob-json> as the app-config payload. An EMPTY <blob-json> makes `versions list` echo nothing,
# so ds_newest_enabled_secret_version resolves empty and ds_access_secret_blob returns "" — the
# no-enabled-version state. A non-empty blob makes list echo a version name and access echo the blob.
_stub_eso() {
  local blob="$1"
  fake_cmd kubectl "
    if [[ \"\$*\" == *' wait '* ]]; then exit 1; fi
    exit 0"
  fake_cmd gcloud "
    if [[ \"\$1\" == secrets && \"\$2\" == versions && \"\$3\" == list ]]; then printf '%s' '${blob:+projects/p/secrets/devstash-app-config/versions/9}'; exit 0; fi
    if [[ \"\$1\" == secrets && \"\$2\" == versions && \"\$3\" == access ]]; then cat <<'JSON'
${blob}
JSON
      exit 0
    fi
    exit 0"
}

@test "wait-secrets-sync: empty blob (no enabled version) → fails loudly, synced=false" {
  _stub_eso ""
  run bash "$SCRIPT"
  assert_failure
  assert_output --partial "no accessible ENABLED version"
  run cat "$GITHUB_OUTPUT"
  assert_output --partial "synced=false"
}

@test "wait-secrets-sync: blob missing infra keys (suspended env) → warns, exits 0, synced=false" {
  # A populated blob with third-party keys but WITHOUT the redis-*/database-* infra props.
  _stub_eso '{"auth-secret":"x","s3-secret":"y"}'
  run bash "$SCRIPT"
  assert_success
  assert_output --partial "::warning::"
  run cat "$GITHUB_OUTPUT"
  assert_output --partial "synced=false"
}

@test "wait-secrets-sync: fully-populated blob that still won't sync → fails loudly (real error)" {
  # Every INFRA_KEY present, yet the ExternalSecret never went Ready → a genuine ESO fault.
  _stub_eso '{"redis-url":"r","redis-ca-cert":"c","database-url":"d","direct-url":"u","database-ca-cert":"a"}'
  run bash "$SCRIPT"
  assert_failure
  assert_output --partial "real error"
}
