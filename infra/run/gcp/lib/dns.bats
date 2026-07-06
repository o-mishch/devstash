#!/usr/bin/env bats
# ensure_cert_cname (dns.sh): the self-healing Certificate Manager DNS-authorization CNAME.
# CONFIRMED LIVE 2026-07-07: Spaceship's PUT /dns/records force:true does NOT upsert a CNAME
# that already exists at that name — it hard-rejects with HTTP 422 "CNAME with host X already
# exists" (verified against the real API). This happens whenever the dns_authorization
# resource is recreated and the token — hence the CNAME target — changes, leaving a stale
# CNAME behind. This file guards the delete-stale-before-put fix and the ordinary
# already-correct / first-time paths around it.
#
# spaceship_api shells straight to curl, so we spy on curl itself and route by which HTTP
# method + URL a call used (mirrors how the real Spaceship API dispatches per verb).

setup() {
  load "${BATS_TEST_DIRNAME}/../../../lib/test_helper"
  # dns.sh alone doesn't define tf_out/log/warn/ok (they live in run.sh/common.sh) — source
  # RUN_SH like db.bats/bringup-gate.bats do, which pulls dns.sh in transitively.
  source "$RUN_SH"
  key=test-key
  secret=test-secret
  root=devstash.one
}

# tofu_out stub: ensure_cert_cname reads two tofu outputs via tf_out, which shells to `tofu_
# output -json`. tofu_ is only actually CALLED later (from tf_out, a different call stack) —
# so it cannot close over local vars from this function; bake the JSON in as a literal instead.
_stub_tofu_outputs() {
  local json
  json="$(jq -nc --arg r "$1" --arg t "$2" \
    '{dns_authorization_cname_record: {value: $r}, dns_authorization_cname_target: {value: $t}}')"
  eval "tofu_() { printf '%s\n' $(printf '%q' "$json"); }"
}

@test "ensure_cert_cname: outputs unavailable → skips without calling the API" {
  tofu_() { printf '{}\n'; }
  spy_cmd curl 'exit 1'
  run ensure_cert_cname "$root" "$key" "$secret"
  assert_success
  assert_output --partial "outputs unavailable"
  [ "$(spy_call_count curl)" -eq 0 ]
}

@test "ensure_cert_cname: correct CNAME already present → no PUT/DELETE, GET only" {
  _stub_tofu_outputs '_acme-challenge.gke.devstash.one.' 'tok-new.11.authorize.certificatemanager.goog.'
  spy_cmd curl 'case "$*" in
    *"-X GET"*) echo "{\"items\":[{\"type\":\"CNAME\",\"name\":\"_acme-challenge.gke\",\"cname\":\"tok-new.11.authorize.certificatemanager.goog.\"}]}" ;;
    *) echo -n 204 ;;
  esac'
  run ensure_cert_cname "$root" "$key" "$secret"
  assert_success
  assert_output --partial "already present"
  refute_output --partial "Removing stale"
  # Only the GET happened — no PUT/DELETE method flags recorded.
  ! grep -q -- '-X PUT' "${SPY_DIR}/curl.calls" 2>/dev/null
  ! grep -q -- '-X DELETE' "${SPY_DIR}/curl.calls" 2>/dev/null
}

@test "ensure_cert_cname: no existing CNAME at all (first issuance) → PUT only, no DELETE" {
  _stub_tofu_outputs '_acme-challenge.gke.devstash.one.' 'tok-new.11.authorize.certificatemanager.goog.'
  spy_cmd curl 'case "$*" in
    *"-X GET"*) echo "{\"items\":[]}" ;;
    *) echo -n 204 ;;
  esac'
  run ensure_cert_cname "$root" "$key" "$secret"
  assert_success
  assert_output --partial "Cert DNS-auth CNAME asserted"
  refute_output --partial "Removing stale"
  ! grep -q -- '-X DELETE' "${SPY_DIR}/curl.calls"
  assert_spy_called_with curl -X PUT
}

@test "ensure_cert_cname: stale CNAME with a different target → DELETEs it before the PUT" {
  _stub_tofu_outputs '_acme-challenge.gke.devstash.one.' 'tok-new.11.authorize.certificatemanager.goog.'
  spy_cmd curl 'case "$*" in
    *"-X GET"*) echo "{\"items\":[{\"type\":\"CNAME\",\"name\":\"_acme-challenge.gke\",\"cname\":\"tok-old.9.authorize.certificatemanager.goog.\"}]}" ;;
    *) echo -n 204 ;;
  esac'
  run ensure_cert_cname "$root" "$key" "$secret"
  assert_success
  assert_output --partial "Removing stale cert DNS-auth CNAME"
  assert_output --partial "tok-old.9.authorize.certificatemanager.goog."
  assert_output --partial "Cert DNS-auth CNAME asserted"
  assert_spy_called_with curl -X DELETE
  assert_spy_called_with curl -X PUT
  # DELETE must run BEFORE PUT — the whole point of the fix. Args are 0x1f-separated per call
  # line (spy_cmd's recording format), so match on the method token alone, not "-X DELETE".
  del_line="$(grep -n $'\037''DELETE' "${SPY_DIR}/curl.calls" | head -1 | cut -d: -f1)"
  put_line="$(grep -n $'\037''PUT' "${SPY_DIR}/curl.calls" | head -1 | cut -d: -f1)"
  [ "$del_line" -lt "$put_line" ]
  # The DELETE body (passed as curl's -d arg, not stdin) must target the stale record by its
  # exact (type,name,cname).
  assert_spy_called_with curl -d '"cname":"tok-old.9.authorize.certificatemanager.goog."'
}

@test "ensure_cert_cname: DELETE failure still attempts the PUT (best-effort, warns)" {
  _stub_tofu_outputs '_acme-challenge.gke.devstash.one.' 'tok-new.11.authorize.certificatemanager.goog.'
  spy_cmd curl 'case "$*" in
    *"-X GET"*) echo "{\"items\":[{\"type\":\"CNAME\",\"name\":\"_acme-challenge.gke\",\"cname\":\"tok-old.9.authorize.certificatemanager.goog.\"}]}" ;;
    *"-X DELETE"*) echo -n 500 ;;
    *) echo -n 204 ;;
  esac'
  run ensure_cert_cname "$root" "$key" "$secret"
  assert_success
  assert_output --partial "Spaceship DELETE returned HTTP 500"
  assert_spy_called_with curl -X PUT
}

@test "ensure_cert_cname: PUT failure (still 422 despite delete attempt) warns with the manual hint" {
  _stub_tofu_outputs '_acme-challenge.gke.devstash.one.' 'tok-new.11.authorize.certificatemanager.goog.'
  spy_cmd curl 'case "$*" in
    *"-X GET"*) echo "{\"items\":[]}" ;;
    *"-X PUT"*) echo -n 422 ;;
    *) echo -n 204 ;;
  esac'
  run ensure_cert_cname "$root" "$key" "$secret"
  assert_success
  assert_output --partial "Spaceship API returned HTTP 422 for the cert CNAME"
  assert_output --partial "_acme-challenge.gke.devstash.one.  CNAME  tok-new.11.authorize.certificatemanager.goog."
}

# ── _gcp_ingress_ip / update_dns's IP-resolution precedence ─────────────────────────────────────
# CONTEXT 2026-07-07: tofu output can be empty/stale (mid-migration, a raw `apply` that never
# surfaced outputs) while the reserved global static IP is still live in GCP — update_dns must
# reach for the authoritative gcloud read instead of trusting tofu state.

# _stub_gcloud_dns_deps <addr-body>: route `gcloud compute addresses describe` through the given
# body, and satisfy ds_access_secret_blob's two-call sequence (versions list → a version name,
# versions access → the ops-config JSON blob) so update_dns's cred read succeeds without
# reaching Secret Manager for real.
_stub_gcloud_dns_deps() {
  local addr_body="$1"
  eval "gcloud() {
    case \"\$*\" in
      *'compute addresses describe'*) $addr_body ;;
      *'secrets versions list'*) echo v1 ;;
      *'secrets versions access'*) echo '{\"spaceship-api-key\":\"k\",\"spaceship-api-secret\":\"s\"}' ;;
      *) return 1 ;;
    esac
  }"
}

@test "_gcp_ingress_ip: reads the reserved address from gcloud, scoped to env + project" {
  ENVIRONMENT=dev PROJECT_ID=proj
  spy_cmd gcloud 'case "$*" in
    *"compute addresses describe"*) echo "8.232.44.235" ;;
    *) exit 1 ;;
  esac'
  run _gcp_ingress_ip
  assert_success
  assert_output "8.232.44.235"
  assert_spy_called_with gcloud compute addresses describe devstash-dev-ip --global --project=proj
}

@test "_gcp_ingress_ip: address not found (suspended env) → empty, no error" {
  ENVIRONMENT=dev PROJECT_ID=proj
  spy_cmd gcloud 'exit 1'
  run _gcp_ingress_ip
  assert_success
  assert_output ""
}

@test "update_dns: prefers the live gcloud IP over tofu output when both are available" {
  ENVIRONMENT=dev PROJECT_ID=proj
  unset INGRESS_IP
  tofu_() { printf '{"ingress_ip_address":{"value":"1.1.1.1"},"app_domain":{"value":"gke.devstash.one"}}\n'; }
  _stub_gcloud_dns_deps 'echo "8.232.44.235"'
  spy_cmd curl 'echo -n 204'
  run update_dns
  assert_success
  assert_output --partial "8.232.44.235"
  refute_output --partial "1.1.1.1"
}

@test "update_dns: falls back to tofu output when the gcloud address read fails" {
  ENVIRONMENT=dev PROJECT_ID=proj
  unset INGRESS_IP
  tofu_() { printf '{"ingress_ip_address":{"value":"1.1.1.1"},"app_domain":{"value":"gke.devstash.one"}}\n'; }
  _stub_gcloud_dns_deps 'return 1'
  spy_cmd curl 'echo -n 204'
  run update_dns
  assert_success
  assert_output --partial "1.1.1.1"
}

@test "update_dns: INGRESS_IP env override still wins over the live gcloud read" {
  ENVIRONMENT=dev PROJECT_ID=proj
  export INGRESS_IP=9.9.9.9
  tofu_() { printf '{"app_domain":{"value":"gke.devstash.one"}}\n'; }
  _stub_gcloud_dns_deps 'echo "8.232.44.235"'
  spy_cmd curl 'echo -n 204'
  run update_dns
  assert_success
  assert_output --partial "9.9.9.9"
  refute_output --partial "8.232.44.235"
  unset INGRESS_IP
}
