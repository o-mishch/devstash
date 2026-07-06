#!/usr/bin/env bats
# Tests for the deploy-gate that blocks until devstash-app-config has an ENABLED version,
# closing the disable-old→add-new version-bump gap (see check-secret-version.sh header).
#
# The gate is a top-level script (sources common.sh, polls ds_newest_enabled_secret_version,
# then exits), so we drive it with `run bash <script>` against a stubbed gcloud rather than
# sourcing a function. The single collaborator is `gcloud secrets versions list --filter=
# state:ENABLED …`, whose stdout (a version resource name, or empty) is the whole signal.
# SECRET_VERSION_WAIT_GAP=0 + a tiny attempt count keeps the timeout path instant.

setup() {
  load "${BATS_TEST_DIRNAME}/../lib/test_helper"
  export GATE="${REPO_ROOT}/infra/ci/check-secret-version.sh"
  export GCP_PROJECT_ID=proj-x
  export SECRET_VERSION_WAIT_GAP=0
  export SECRET_VERSION_WAIT_ATTEMPTS=3
}

# _stub_versions_list <stdout>: fake `gcloud secrets versions list …` to echo <stdout> (a version
# resource name when an enabled version exists, empty when none do — the two states the gate keys
# on). Any other gcloud subcommand is a harmless no-op. <stdout> is the helper's $1; it is
# interpolated into the emitted stub body, while the stub's OWN positional args stay escaped (\$1…).
_stub_versions_list() {
  local out="$1"
  fake_cmd gcloud "
    if [[ \"\$1\" == secrets && \"\$2\" == versions && \"\$3\" == list ]]; then printf '%s' '${out}'; exit 0; fi
    exit 0"
}

@test "gate: an enabled version is present → passes immediately" {
  _stub_versions_list "projects/118254458384/secrets/devstash-app-config/versions/11"
  run bash "$GATE"
  assert_success
  assert_output --partial "has an ENABLED version"
}

@test "gate: no enabled version for the whole window → fails loudly (real fault, not skip)" {
  _stub_versions_list ""
  run bash "$GATE"
  assert_failure
  assert_output --partial "no accessible ENABLED version"
}

@test "gate: an enabled version that appears mid-window → passes (the bump gap closed)" {
  # First two `versions list` calls return empty (the gap), the third returns a version name.
  # A counter file in the per-test tmpdir survives across the stub's separate invocations.
  export _CNT="${BATS_TEST_TMPDIR}/n"
  printf 0 > "$_CNT"
  fake_cmd gcloud "
    if [[ \"\$1\" == secrets && \"\$2\" == versions && \"\$3\" == list ]]; then
      n=\$(cat '$_CNT'); n=\$((n + 1)); printf '%s' \"\$n\" > '$_CNT'
      if [[ \"\$n\" -ge 3 ]]; then printf '%s' 'projects/p/secrets/devstash-app-config/versions/12'; fi
      exit 0
    fi
    exit 0"
  run bash "$GATE"
  assert_success
  assert_output --partial "has an ENABLED version"
}

@test "gate: missing GCP_PROJECT_ID → fails fast before polling" {
  unset GCP_PROJECT_ID
  _stub_versions_list "projects/p/secrets/devstash-app-config/versions/1"
  run bash "$GATE"
  assert_failure
  assert_output --partial "GCP_PROJECT_ID is required"
}
