#!/usr/bin/env bats
# ds_ar_writable — the Artifact Registry writability gate build-push.sh polls before pushing.
#
# Regression this file locks down (live 2026-07-06, run 28795125411, attempt 40/40 hang): the old
# implementation derived the caller's identity from `gcloud config get-value account` and matched it
# against the repo IAM policy. Under Workload Identity Federation the `google-github-actions/auth`
# action writes an ADC external_account file and registers NO gcloud account, so that command returns
# EMPTY in CI — the `[[ -n "$account" ]]` guard then failed on EVERY poll and the gate never cleared
# even though the deployer SA genuinely held repoAdmin. The fix asks the AR `:testIamPermissions`
# REST API "can THE CALLER upload here", which is identity-agnostic. These tests assert the new
# behaviour AND that an empty `gcloud config get-value account` no longer forces a false negative.
#
# Collaborators (gcloud describe + print-access-token, curl to the REST endpoint) are fake_cmd
# stubs — the test asserts the RETURN CODE for a given probe response, not exact call plans.

setup() {
  # test_helper lives under infra/run/gcp/lib (shared by the whole infra suite); this .bats file
  # sits in infra/lib, so load it by its path relative to this file rather than the local dir.
  load "${BATS_TEST_DIRNAME}/../run/gcp/lib/test_helper"
  source "$COMMON_SH"
}

# _stub_ar <describe-rc> <token> <curl-body>: fake the three collaborators ds_ar_writable calls.
#   gcloud: `artifacts repositories describe …` → exit <describe-rc>; `auth print-access-token` →
#           echo <token> (empty token ⇒ the [[ -n ]] guard path); `config get-value account` →
#           echo NOTHING (the real WIF behaviour we must tolerate) — anything else exits 0.
#   curl:   echo <curl-body> (the testIamPermissions JSON) and exit 0.
_stub_ar() {
  local describe_rc="$1" token="$2" curl_body="$3"
  fake_cmd gcloud "
    if [[ \"\$1\" == artifacts && \"\$2\" == repositories && \"\$3\" == describe ]]; then exit ${describe_rc}; fi
    if [[ \"\$1\" == auth && \"\$2\" == print-access-token ]]; then printf '%s' ${token:+\"${token}\"}; exit 0; fi
    if [[ \"\$1\" == config && \"\$2\" == get-value && \"\$3\" == account ]]; then exit 0; fi
    exit 0"
  fake_cmd curl "cat <<'JSON'
${curl_body}
JSON"
}

@test "ds_ar_writable: caller has uploadArtifacts (permission echoed back) → writable" {
  _stub_ar 0 tok-abc '{"permissions":["artifactregistry.repositories.uploadArtifacts"]}'
  run ds_ar_writable us-central1 proj-x devstash
  assert_success
}

@test "ds_ar_writable: caller lacks uploadArtifacts (empty permissions) → not writable" {
  _stub_ar 0 tok-abc '{}'
  run ds_ar_writable us-central1 proj-x devstash
  assert_failure
}

@test "ds_ar_writable: repo not yet recreated (describe 404) → not writable, never probes IAM" {
  _stub_ar 1 tok-abc '{"permissions":["artifactregistry.repositories.uploadArtifacts"]}'
  run ds_ar_writable us-central1 proj-x devstash
  assert_failure
}

@test "ds_ar_writable: no caller token (print-access-token empty) → not writable" {
  _stub_ar 0 '' '{"permissions":["artifactregistry.repositories.uploadArtifacts"]}'
  run ds_ar_writable us-central1 proj-x devstash
  assert_failure
}

# The core regression: an EMPTY `gcloud config get-value account` (the real WIF runner behaviour)
# must NOT make the gate false when the caller genuinely can push. The stub's config-account branch
# echoes nothing; a granted testIamPermissions response must still resolve to writable.
@test "ds_ar_writable: writable even when 'gcloud config get-value account' is empty (WIF regression)" {
  _stub_ar 0 tok-abc '{"permissions":["artifactregistry.repositories.uploadArtifacts"]}'
  run ds_ar_writable us-central1 proj-x devstash
  assert_success
}
