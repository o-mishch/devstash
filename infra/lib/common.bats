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
  # test_helper is the shared infra-suite helper, co-located here in infra/lib.
  load "${BATS_TEST_DIRNAME}/test_helper"
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

# ── ds_ar_wait — the bounded poll shared by build-push.sh (CI gate) and run.sh (_wait_ar_push_ready).
# It wraps poll_until + ds_ar_writable; assert it returns the instant the probe passes, and that it
# gives up after AR_WAIT_ATTEMPTS without hanging. Kept tiny via AR_WAIT_ATTEMPTS/GAP overrides so the
# timeout case does not actually sleep the default 40×15s.
@test "ds_ar_wait: returns 0 the moment the deployer SA can push (writable on attempt 1)" {
  _stub_ar 0 tok-abc '{"permissions":["artifactregistry.repositories.uploadArtifacts"]}'
  AR_WAIT_ATTEMPTS=3 AR_WAIT_GAP=0 run ds_ar_wait us-central1 proj-x devstash
  assert_success
}

@test "ds_ar_wait: gives up after AR_WAIT_ATTEMPTS when never writable (bounded, returns 1)" {
  # describe 404 → ds_ar_writable never true → the poll exhausts its budget rather than hanging.
  _stub_ar 1 tok-abc '{"permissions":["artifactregistry.repositories.uploadArtifacts"]}'
  AR_WAIT_ATTEMPTS=2 AR_WAIT_GAP=0 run ds_ar_wait us-central1 proj-x devstash
  assert_failure
}

# ── fmt_dur / stage / _ts_tag — the resume narration primitives ──
@test "fmt_dur: seconds under a minute render as Ns" {
  run fmt_dur 44; assert_output "44s"
  run fmt_dur 0;  assert_output "0s"
}

@test "fmt_dur: a minute-plus renders as MmSSs (zero-padded seconds)" {
  run fmt_dur 592; assert_output "9m52s"   # 9*60+52
  run fmt_dur 65;  assert_output "1m05s"
}

@test "fmt_dur: an hour-plus renders as HhMMm" {
  run fmt_dur 3780; assert_output "1h03m"  # 1h + 3m
}

@test "_ts_tag: emits nothing when no span is open (plain log/ok/warn unchanged)" {
  unset _SPAN_T0
  run _ts_tag; assert_output ""
}

@test "_ts_tag: inside a span emits the '+elapsed' tag (span origin is honoured)" {
  begin_span 6
  _SPAN_T0=$(( SECONDS - 5 ))          # pin a deterministic 5s elapsed
  run _ts_tag; assert_output --partial "+5s"
  end_span
}

@test "stage: auto-increments the counter and reads the total from begin_span (callers pass only text)" {
  begin_span 6                          # the total lives here — never repeated per stage call
  run stage "first";  assert_output --partial "[stage 1/6] first"
  # `run` executes in a subshell, so the parent counter didn't advance — drive both in one shell:
  local out; out="$( stage "a"; stage "b"; stage "c" )"
  echo "$out" | grep -qF "[stage 1/6] a"
  echo "$out" | grep -qF "[stage 2/6] b"
  echo "$out" | grep -qF "[stage 3/6] c"
  end_span
}

@test "stage: the total comes from begin_span, not the call site (change it in one place)" {
  begin_span 3                          # a DIFFERENT total flows to every stage without touching the calls
  run stage "only";  assert_output --partial "[stage 1/3] only"
  end_span
}

@test "end_span: after close, log() drops the timestamp tag and the stage total" {
  begin_span 6
  end_span
  run _ts_tag; assert_output ""
  # Total is unset too — a stray post-span stage falls back to "?" rather than leaking the old 6.
  run stage "orphan"; assert_output --partial "[stage 1/?] orphan"
}
