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
  # The per-attempt message must render with the FORWARDED repo_id + gap (regression guard for the
  # move from a nested closure to _ds_ar_wait_msg's poll_until `::`-group args $3=repo_id, $4=gap).
  assert_output --partial "Artifact Registry 'devstash' not writable yet (attempt 1/2)"
  assert_output --partial "waiting 0s"
}

# ── ds_cluster_teardown_in_progress — the event-based teardown signal wait_for_cluster aborts on.
# Two positive signals (status STOPPING/ERROR, or an in-flight DELETE_CLUSTER op) and the RUNNING
# negative. `describe --format=value(status)` prints the status; `operations list` prints op names
# (empty = none in flight). A transient gcloud error must read as NOT-torn-down (return 1), not abort.
#
# _stub_gke_state <status> <delete-ops>: describe echoes <status>; operations list echoes <delete-ops>
# (newline-separated op names, empty = none). Any other gcloud subcommand is a no-op success.
_stub_gke_state() {
  local status="$1" delete_ops="$2"
  fake_cmd gcloud "
    if [[ \"\$1 \$2\" == 'container clusters' && \"\$3\" == describe ]]; then printf '%s' '${status}'; exit 0; fi
    if [[ \"\$1 \$2\" == 'container operations' && \"\$3\" == list ]]; then printf '%s' '${delete_ops}'; exit 0; fi
    exit 0"
}

@test "ds_cluster_teardown_in_progress: status STOPPING → teardown detected (0)" {
  _stub_gke_state STOPPING ""
  run ds_cluster_teardown_in_progress devstash-dev-gke proj-x us-central1
  assert_success
}

@test "ds_cluster_teardown_in_progress: status ERROR → teardown detected (0)" {
  _stub_gke_state ERROR ""
  run ds_cluster_teardown_in_progress devstash-dev-gke proj-x us-central1
  assert_success
}

@test "ds_cluster_teardown_in_progress: RUNNING with no delete op → not torn down (1)" {
  _stub_gke_state RUNNING ""
  run ds_cluster_teardown_in_progress devstash-dev-gke proj-x us-central1
  assert_failure
}

@test "ds_cluster_teardown_in_progress: RUNNING but an in-flight DELETE_CLUSTER op → teardown detected (0)" {
  # A concurrent actor's DELETE can land before the status flips — the op-list branch catches it.
  _stub_gke_state RUNNING "operation-1783438990524-5e20f915"
  run ds_cluster_teardown_in_progress devstash-dev-gke proj-x us-central1
  assert_success
}

@test "ds_cluster_teardown_in_progress: probe error reads as NOT torn down (1) but WARNS so a persistent blindness is visible" {
  # Both probes error; empty output → RUNNING-equivalent, so a blip never aborts a healthy resume (the
  # caller re-checks each poll iteration). But the failure is WARNED (not silently swallowed) so a
  # PERSISTENT auth failure that blinds the guard for the whole wait shows up in the resume log.
  fake_cmd gcloud "exit 1"
  run ds_cluster_teardown_in_progress devstash-dev-gke proj-x us-central1
  assert_failure
  assert_output --partial "teardown probe"
}

# ── poll_until — the shared bounded poll (dot form + -m message hook with forwarded msg_args) ──
# The -m `::`-group is what lets a module-scope message fn (e.g. _ds_ar_wait_msg) receive per-wait
# context without closing over caller locals; assert the forwarding + backward-compatible dot form.
@test "poll_until: -m forwards the :: msg_args group verbatim to the message fn (attempt, max, then args)" {
  _mfn() { echo "MSG a=$1 m=$2 repo=$3 gap=$4"; }
  # A predicate that fails the first 2 calls then succeeds, so the message fires exactly twice.
  _n=0; _pred() { _n=$((_n + 1)); [ "$_n" -ge 3 ]; }
  run poll_until -m _mfn :: my-repo 15 :: 5 0 -- _pred
  assert_success
  assert_line --index 0 "MSG a=1 m=5 repo=my-repo gap=15"
  assert_line --index 1 "MSG a=2 m=5 repo=my-repo gap=15"
}

@test "poll_until: bare -m with no :: group calls the fn with just attempt/max (empty args, no set -u error)" {
  _mfn() { echo "attempt=$1/$2 extra=[${3:-none}]"; }
  _n=0; _pred() { _n=$((_n + 1)); [ "$_n" -ge 2 ]; }
  run poll_until -m _mfn 3 0 -- _pred
  assert_success
  assert_output "attempt=1/3 extra=[none]"
}

@test "poll_until: dot form (no -m) is unchanged — prints a dot per failed attempt, returns 1 on timeout" {
  _pred() { false; }   # never succeeds → exhausts the 3-attempt budget
  run poll_until 3 0 -- _pred
  assert_failure
  assert_output ".."   # 2 dots: printed after attempts 1 and 2, not after the final give-up
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

# --- is_network_error: SIGNATURE-gated transient-transport classifier ---------------------------
# Locks the exact strings a broken uplink emits (observed live during a `suspend` mid-destroy) so
# tofu_locked retries ONLY these, and never a real provider/quota/permission error.

@test "is_network_error: 'write: broken pipe' → matches (0)" {
  run is_network_error 'Error waiting for deleting GKE cluster: write tcp ...->...:443: write: broken pipe'
  assert_success
}

@test "is_network_error: 'http2: client connection lost' → matches (0)" {
  run is_network_error 'Failed to upload state ...: Post ...: http2: client connection lost'
  assert_success
}

@test "is_network_error: 'Failed to upload state' → matches (0) — un-persisted state is retryable" {
  run is_network_error 'Error: Failed to upload state to gs://bucket/gke/dev/default.tfstate'
  assert_success
}

@test "is_network_error: a real provider error (quota/permission) does NOT match (1) — fails loudly first try" {
  run is_network_error 'Error: googleapi: Error 403: Permission denied on resource, forbidden'
  assert_failure
}

@test "is_network_error: a resource-level 'Error waiting ... timeout' is NOT a transport drop (1)" {
  # Anchored to i/o timeout / Client.Timeout, not a bare 'timeout', so a slow-op failure that is a
  # genuine provider timeout still fails loudly rather than being retried as a network blip.
  run is_network_error 'Error: Error waiting for Creating Instance: timeout while waiting for state to become RUNNABLE'
  assert_failure
}

# --- tofu_locked: bounded network retry ---------------------------------------------------------
# A fake invoker whose success/failure is driven by a per-test counter file. On a "fail" turn it
# prints a network signature to stdout (captured by _tofu_attempt into _TOFU_ATTEMPT_OUTPUT) and
# returns non-zero; after <fail_count> turns it prints ok and returns 0. _recover_state_lock is a
# no-op here — the network branch must NOT call it (nothing to recover from a transport blip).
_net_invoker_setup() {
  COUNTER="$BATS_TEST_TMPDIR/net_calls"; : > "$COUNTER"
  FAIL_TURNS="$1"
  _recover_state_lock() { echo "RECOVER-CALLED" >> "$BATS_TEST_TMPDIR/recover"; return 1; }
  fake_invoker() {
    local n; n="$(wc -l < "$COUNTER" | tr -d ' ')"; echo x >> "$COUNTER"
    if (( n < FAIL_TURNS )); then
      echo 'Error: Failed to upload state ...: http2: client connection lost'; return 1
    fi
    echo 'Apply complete!'; return 0
  }
}

@test "tofu_locked: retries a transient network drop and succeeds on the next attempt" {
  _net_invoker_setup 1
  TOFU_NETWORK_RETRY_GAP=0 TOFU_NETWORK_RETRIES=3 run tofu_locked _recover_state_lock -- fake_invoker destroy -auto-approve
  assert_success
  assert_output --partial 'transient network drop'
  assert_output --partial 'succeeded after network retry 1/3'
  # 2 invocations total (1 failed + 1 success); recover_fn never touched.
  assert_equal "$(wc -l < "$COUNTER" | tr -d ' ')" 2
  [ ! -f "$BATS_TEST_TMPDIR/recover" ]
}

@test "tofu_locked: gives up after TOFU_NETWORK_RETRIES and re-propagates the failure (bounded)" {
  _net_invoker_setup 99   # never succeeds
  TOFU_NETWORK_RETRY_GAP=0 TOFU_NETWORK_RETRIES=2 run tofu_locked _recover_state_lock -- fake_invoker destroy -auto-approve
  assert_failure
  # 1 initial + 2 retries = 3 invocations, then it stops (does not spin forever).
  assert_equal "$(wc -l < "$COUNTER" | tr -d ' ')" 3
}

@test "tofu_locked: a non-network, non-lock failure is NOT retried (fails loudly on the first attempt)" {
  COUNTER="$BATS_TEST_TMPDIR/net_calls"; : > "$COUNTER"
  _recover_state_lock() { return 1; }
  fake_invoker() { echo x >> "$COUNTER"; echo 'Error: googleapi: Error 403: Permission denied'; return 1; }
  TOFU_NETWORK_RETRY_GAP=0 TOFU_NETWORK_RETRIES=3 run tofu_locked _recover_state_lock -- fake_invoker apply
  assert_failure
  assert_equal "$(wc -l < "$COUNTER" | tr -d ' ')" 1
}
