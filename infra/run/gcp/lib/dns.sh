# shellcheck shell=bash
# Spaceship DNS management for the GCP deploy tooling. SOURCED by infra/run/gcp/run.sh (never
# executed) — it shares run.sh's shell scope, so the functions here rely on state the parent
# already established. Split out of run.sh purely to keep that orchestrator readable; this is
# organisational, not a standalone module.
#
# Depends on (provided by run.sh before this file is sourced):
#   globals   PROJECT_ID, ENVIRONMENT, NS; optional env overrides INGRESS_IP, SPACESHIP_API_KEY/-SECRET
#   helpers   log/ok/warn/die (infra/lib/common.sh), tf_out
#
# Source-guard: sourcing twice is a harmless no-op.
[[ -n "${_DEVSTASH_GCP_DNS_SH:-}" ]] && return 0
_DEVSTASH_GCP_DNS_SH=1

# dns_hint: print the DNS A-record the user must create after `apply`.
# TLS is served by the project-scoped Certificate Manager cert (envs/dev/certmanager.tf), which
# is pre-provisioned via a one-time DNS-auth CNAME and SURVIVES suspend — so once the A-record
# resolves to the Gateway IP, HTTPS works immediately (no per-resume cert-provisioning wait; that
# wait only happened under the old cluster-scoped ManagedCertificate). Also reminds about the
# Stripe webhook + OAuth URIs.
dns_hint() {
  local ip dom
  ip="$(_gcp_ingress_ip)"; ip="${ip:-$(tf_out ingress_ip_address)}"
  dom="$(tf_out app_domain)"
  log "DNS — point your subdomain at the Gateway static IP; the Certificate Manager cert is already provisioned"
  echo "  Add an A-record:  ${dom:-<app_domain>}  →  ${ip:-<run: tofu output ingress_ip_address>}"
  echo "  Verify:           dig +short ${dom:-<app_domain>}"
  echo "  Gateway status:   kubectl -n $NS get gateway devstash-web -o wide"
  # Cert status is easiest to read via 'run.sh status' (it resolves the cert name + queries
  # managed.state for you); the raw gcloud form is documented in 08-gcp-bootstrap.md §DNS.
  echo "  Cert status:      bash infra/run/gcp/run.sh status   # shows the Certificate Manager managed.state"
  warn "Do NOT repoint the apex/www (those serve prod on Vercel) — use the subdomain only."
  warn "Also do §7c (Stripe webhook) + §7d (OAuth redirect URIs) in 08-gcp-bootstrap.md."
  warn "FIRST-TIME ONLY: the Google-managed cert provisions once (~15-60 min) after the DNS-auth"
  warn "CNAME resolves. That CNAME is asserted automatically by update_dns (self-healing) — no"
  warn "manual step. Once provisioned it persists across every suspend/resume — resume never"
  warn "waits on a cert."
}

# spaceship_api: single Spaceship DNS API entrypoint — owns the host, auth headers, and the
# `|| true` (a transport error must stay non-fatal so DNS work never hard-fails a resume).
# Reads $key/$secret from the caller's scope (update_dns is the sole consumer).
#   GET             → echoes the response body
#   PUT/DELETE/...  → echoes the HTTP status code (-o /dev/null -w '%{http_code}')
spaceship_api() {
  local method="$1" path="$2" body="${3:-}"
  local url="https://spaceship.dev/api/v1/dns/records/${path}"
  local -a hdr=(-H "X-API-Key: ${key}" -H "X-API-Secret: ${secret}" -H 'Content-Type: application/json')
  if [[ "$method" == GET ]]; then
    curl -s -X GET "${hdr[@]}" "$url" || true
  else
    curl -s -o /dev/null -w '%{http_code}' -X "$method" "${hdr[@]}" "$url" ${body:+-d "$body"} || true
  fi
}

# _gcp_ingress_ip: read the reserved global static IP straight from GCP (the resource itself,
# not tofu state) — `gcloud compute addresses describe <prefix>-ip --global`. Name matches
# modules/network's `"${name_prefix}-ip"` (name_prefix = "devstash-${ENVIRONMENT}"). This is
# the authoritative source: it's correct even when tofu state/outputs are empty, stale, or
# mid-migration (a `tofu output` after a raw `apply` that never surfaced outputs, or any drift
# between state and the live project). Echoes nothing (and warns) if the address doesn't exist
# (e.g. the environment is suspended and the IP was released).
_gcp_ingress_ip() {
  gcloud compute addresses describe "devstash-${ENVIRONMENT}-ip" --global \
    --project="$PROJECT_ID" --format='value(address)' 2>/dev/null || true
}

# update_dns: re-point the app's A-record at the current ingress IP via the Spaceship
# DNS API. Needed on resume because the ingress IP is released on suspend and a fresh
# one is allocated each resume. Best-effort: prints a manual hint if creds are missing.
# Credentials come from env (SPACESHIP_API_KEY / SPACESHIP_API_SECRET) or, failing that,
# the consolidated Secret Manager ops blob devstash-ops-config (see `set-dns-creds`).
#
# REPLACE, never append. Spaceship's PUT /dns/records upserts by (type,name) but ONLY
# within the API's own "External API Custom Group", and force:true silences the conflict
# checker rather than reconciling the zone — so any OTHER A-record for this host survives:
# a stale IP from a prior resume, or a duplicate created by hand in the "Default Record
# Group". Two live A-records for one host make resolvers round-robin onto the dead ingress
# IP (intermittent 502s until the stale record is pruned). So we mirror the Spaceship Terraform
# provider's contract — upsert the desired record, then DELETE every other A-record for the
# host — instead of blindly adding one.
update_dns() {
  local ip domain root sub key secret code existing prune del_code
  # Resolution order: INGRESS_IP (explicit manual override) > live GCP read (authoritative —
  # correct even when tofu state is stale/empty/mid-migration) > tofu output (last-resort
  # fallback if the gcloud read itself fails, e.g. transient API error).
  ip="${INGRESS_IP:-$(_gcp_ingress_ip)}"
  ip="${ip:-$(tf_out ingress_ip_address)}"
  if [[ -z "$ip" || "$ip" == "null" ]]; then
    warn "no ingress IP available (environment suspended?) — skipping DNS update"
    warn "Pass one explicitly:  INGRESS_IP=<ip> bash infra/run/gcp/run.sh update-dns"
    return 0
  fi
  domain="$(tf_out app_domain)"
  [[ -n "$domain" ]] || { warn "app_domain not set — skipping DNS update"; return 0; }
  # gke.devstash.one → registered domain "devstash.one" (API path) + host label "gke".
  # Assumes a single subdomain label; adjust if app_domain ever gains more.
  root="${domain#*.}"
  sub="${domain%%.*}"

  # Ops creds live consolidated in the devstash-ops-config JSON blob (spaceship-api-key /
  # spaceship-api-secret properties). Read the blob ONCE, then pull each property with jq —
  # env vars still win for a one-off override. `|| true` keeps a missing/suspended secret a
  # warn-and-skip, not a hard failure. Resolve the newest ENABLED version (not `access latest`)
  # for the same reason as everywhere else in this tooling (common.sh / auto-suspend-prepare.sh):
  # a stray DISABLED top version (e.g. an interrupted rotation) makes `access latest` fail with
  # FAILED_PRECONDITION, which would silently break the DNS re-point after resume.
  local ops_blob
  ops_blob="$(ds_access_secret_blob devstash-ops-config "$PROJECT_ID")"
  key="${SPACESHIP_API_KEY:-$(printf '%s' "$ops_blob" | jq -r '."spaceship-api-key" // empty' 2>/dev/null || true)}"
  secret="${SPACESHIP_API_SECRET:-$(printf '%s' "$ops_blob" | jq -r '."spaceship-api-secret" // empty' 2>/dev/null || true)}"
  if [[ -z "$key" || -z "$secret" ]]; then
    warn "Spaceship API creds not found (env SPACESHIP_API_KEY/SPACESHIP_API_SECRET or"
    warn "Secret Manager devstash-ops-config via 'run.sh set-dns-creds')."
    warn "Update the A-record manually:  $domain  →  $ip"
    return 0
  fi

  log "Updating Spaceship DNS A-record: $domain → $ip"
  # Desired-state payload — shared by the upsert (step 1) and re-assert (step 3) so the two
  # writes can never drift apart. Short TTL (300s) so the change is picked up quickly.
  local put_body="{\"force\":true,\"items\":[{\"type\":\"A\",\"name\":\"${sub}\",\"address\":\"${ip}\",\"ttl\":300}]}"
  # 1) Upsert the desired record FIRST so the host is never left without an A-record even
  #    if the prune below fails. force:true is still required — the stale record still
  #    exists at this point, so without it the conflict checker would reject the PUT.
  code="$(spaceship_api PUT "$root" "$put_body")"
  if [[ ! "$code" =~ ^2 ]]; then
    warn "Spaceship API returned HTTP ${code:-000} — set the A-record manually: $domain → $ip"
    return 0
  fi

  # 2) Prune every OTHER A-record for this host (any address != the new ingress IP). GET
  #    the zone, keep only host A-records whose address differs, and DELETE them so exactly
  #    one A-record for $sub remains. Best-effort: a prune miss must not fail the resume,
  #    but it is warned so the leftover can be removed by hand.
  existing="$(spaceship_api GET "${root}?take=500&skip=0")"
  prune="$(printf '%s' "$existing" \
    | jq -c --arg n "$sub" --arg ip "$ip" \
        '[.items[]? | select(.type == "A" and .name == $n and .address != $ip) | {type, name, address}]' \
    2>/dev/null || printf '[]')"
  if [[ -n "$prune" && "$prune" != "[]" ]]; then
    log "Pruning stale $sub A-record(s): $(printf '%s' "$prune" | jq -r 'map(.address) | join(", ")')"
    del_code="$(spaceship_api DELETE "$root" "$prune")"
    [[ "$del_code" =~ ^2 ]] \
      || warn "Spaceship prune returned HTTP ${del_code:-000} — remove leftover $sub A-record(s) manually (Default Record Group entries may not be API-deletable)."
    # 3) Re-assert the desired record LAST, so the final write is always the correct one.
    #    The prune DELETE payload targets (type,name,address); if Spaceship ever widened
    #    that match to (type,name) it would drop the good record with the stale ones,
    #    leaving the host pointing nowhere. This idempotent upsert guarantees the zone ends
    #    with exactly gke → the current ingress IP regardless of DELETE semantics. It does
    #    NOT speed propagation (TTL-bound) — it only guarantees correctness after the prune.
    code="$(spaceship_api PUT "$root" "$put_body")"
    [[ "$code" =~ ^2 ]] \
      || warn "Spaceship re-assert returned HTTP ${code:-000} — verify the A-record manually: $domain → $ip"
  fi

  ok "DNS A-record updated ($domain → $ip). Allow a few minutes for propagation + cert."

  # Self-heal the one-time cert DNS-authorization CNAME. Historically this was a MANUAL
  # step (see certmanager.tf) — if an operator skipped it the Google-managed cert never
  # provisions and HTTPS is dead (no peer certificate). Asserting it here on every
  # apply/resume makes the step idempotent + self-healing, and re-asserts the correct
  # target if the dns_authorization resource is ever recreated with a fresh token.
  ensure_cert_cname "$root" "$key" "$secret"
}

# ensure_cert_cname: idempotently upsert the Certificate Manager DNS-authorization CNAME
# into the Spaceship zone from the tofu outputs. Args: zone root (e.g. devstash.one) plus
# the already-resolved Spaceship API key/secret (spaceship_api reads $key/$secret from scope).
#
# PERMANENCE (cloud.google.com/certificate-manager/docs/dns-authorizations): this CNAME is
# required not only for first issuance but for every ~60-day renewal — Certificate Manager
# revalidates domain control before each renewal. Deleting it breaks renewal and eventually
# HTTPS. So this record is UPSERTED and never pruned; update_dns's A-record prune only
# matches `type == "A"`, so it can never touch this CNAME. It must also be the ONLY record
# for its name (no competing TXT/CNAME) — a plain PUT upsert by (type,name) guarantees that.
#
# force:true does NOT make the PUT upsert a CNAME that already exists at that name — Spaceship
# hard-rejects with 422 "CNAME with host X already exists" (confirmed against the live API;
# `force` only turns off the *conflict* checker across record types, not same-type collisions).
# This bites whenever the dns_authorization resource is recreated (fresh renewal, `apply`
# rebuild) and the token — hence the CNAME target — changes. So a stale CNAME must be DELETEd
# by its exact (type,name,cname) before the new one is PUT, same explicit prune-then-reassert
# shape update_dns already uses for the A-record.
ensure_cert_cname() {
  local root="$1" key="$2" secret="$3" record target name existing have stale code
  record="$(tf_out dns_authorization_cname_record)"   # e.g. _acme-challenge.gke.devstash.one.
  target="$(tf_out dns_authorization_cname_target)"    # e.g. <uuid>.<n>.authorize.certificatemanager.goog.
  if [[ -z "$record" || "$record" == "null" || -z "$target" || "$target" == "null" ]]; then
    warn "cert DNS-auth CNAME outputs unavailable — skipping (run 'apply' to surface them)"
    return 0
  fi
  # Spaceship names are relative to the zone root: strip the trailing dot and the ".$root"
  # suffix. "_acme-challenge.gke.devstash.one." → "_acme-challenge.gke".
  name="${record%.}"; name="${name%".$root"}"

  # Skip the write if the correct CNAME already exists (avoids a needless API call on the
  # common resume path where the record is long-since in place). Match by (name,cname).
  existing="$(spaceship_api GET "${root}?take=500&skip=0")"
  have="$(printf '%s' "$existing" \
    | jq -r --arg n "$name" --arg t "$target" \
        'any(.items[]?; .type == "CNAME" and .name == $n and (.cname == $t or .cname == ($t + "."))) // false' \
    2>/dev/null || printf 'false')"
  if [[ "$have" == "true" ]]; then
    ok "Cert DNS-auth CNAME already present ($name → $target)"
    return 0
  fi

  # Any OTHER CNAME already sitting at this name is stale (a prior dns_authorization
  # token) and must be deleted first — Spaceship's PUT will 422 rather than replace it.
  stale="$(printf '%s' "$existing" \
    | jq -c --arg n "$name" --arg t "$target" \
        '[.items[]? | select(.type == "CNAME" and .name == $n and .cname != $t and .cname != ($t + "."))
          | {type, name, cname}]' \
    2>/dev/null || printf '[]')"
  if [[ -n "$stale" && "$stale" != "[]" ]]; then
    log "Removing stale cert DNS-auth CNAME(s) at $name: $(printf '%s' "$stale" | jq -r 'map(.cname) | join(", ")')"
    code="$(spaceship_api DELETE "$root" "$stale")"
    [[ "$code" =~ ^2 ]] \
      || warn "Spaceship DELETE returned HTTP ${code:-000} for stale cert CNAME(s) — the PUT below may still 422."
  fi

  log "Asserting cert DNS-auth CNAME: $name → $target"
  local put_body="{\"force\":true,\"items\":[{\"type\":\"CNAME\",\"name\":\"${name}\",\"cname\":\"${target}\",\"ttl\":300}]}"
  code="$(spaceship_api PUT "$root" "$put_body")"
  if [[ "$code" =~ ^2 ]]; then
    ok "Cert DNS-auth CNAME asserted — Google provisions/renews the cert once it resolves (~15-60 min first time)."
  else
    warn "Spaceship API returned HTTP ${code:-000} for the cert CNAME — add it manually:"
    warn "  $record  CNAME  $target"
  fi
}

# set-dns-creds: store the Spaceship DNS API key + secret in Secret Manager so resume
# can fetch them without keeping them in shell history. Values are read from hidden
# prompts (or stdin) and never echoed. Re-run to rotate.
set_dns_creds() {
  ensure_tfvars
  # read_secret (common.sh) single-sources the never-echo-a-credential input idiom (hidden tty
  # prompt, or a plain stdin line when piped) shared with rotate_secret in run.sh.
  local key secret
  read_secret "Spaceship API key: " key
  read_secret "Spaceship API secret: " secret
  [[ -n "$key" && -n "$secret" ]] || die "both key and secret are required"
  log "Storing Spaceship DNS API creds in the consolidated devstash-ops-config secret (project $PROJECT_ID)"
  # Both creds live as properties of ONE JSON blob (matches the Terraform-managed
  # devstash-ops-config in envs/dev/dns.tf — see update_dns's reader). jq builds the object
  # so values with special characters are encoded correctly and never touch the process
  # arg list. Create the secret if absent, then add a new version. --replication-policy
  # matches the auto replication used elsewhere in this project.
  local name=devstash-ops-config blob
  blob="$(jq -nc --arg k "$key" --arg s "$secret" '{"spaceship-api-key":$k,"spaceship-api-secret":$s}')"
  gcloud secrets describe "$name" --project="$PROJECT_ID" >/dev/null 2>&1 \
    || gcloud secrets create "$name" --replication-policy=automatic --project="$PROJECT_ID"
  printf '%s' "$blob" | gcloud secrets versions add "$name" --data-file=- --project="$PROJECT_ID"
  ok "Spaceship DNS creds stored in devstash-ops-config. Rotate them in the Spaceship dashboard if they were ever shared in plaintext."
}
