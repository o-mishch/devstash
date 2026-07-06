# Certificate Manager TLS for the GKE Gateway.
#
# WHY THIS REPLACES the k8s ManagedCertificate CRD (overlays/gcp/managed-cert.yaml):
#   The ManagedCertificate CRD is CLUSTER-scoped — it is destroyed with the cluster on every
#   deep suspend and must RE-PROVISION (~15-60 min) on resume, during which HTTPS is down. That
#   is the entire reason the overlay carries a hardcoded pre-shared-cert stopgap. Certificate
#   Manager resources are PROJECT-scoped Google Cloud resources (not k8s CRDs), so they SURVIVE
#   the cluster teardown: the cert stays provisioned across suspend/resume, the Gateway on resume
#   points straight at the existing map, and TLS is live the instant the LB attaches — no
#   reprovision gap, no pre-shared-cert hack. This is the modern Gateway-API TLS path (GKE Ingress
#   cannot use Certificate Manager at all).
#
# ALWAYS-ON (not gated on environment_active): the cert/map/entry hold no compute and cost $0.
# COST FACT (verified — cloud.google.com/certificate-manager/pricing): "no additional charge for
# the first 100 certificates" per project; this stack has ONE cert, and the map/entry/DNS-auth are
# management resources with no separate per-unit charge. Standard ECDSA/RSA keys have no
# per-connection charge either. So "always-on" means the resource EXISTS across suspend (like the
# tfstate bucket or the always-on node SA) — it does NOT bill, so it does not breach $0-running.
# The whole point of keeping it ungated is that a Google-managed cert takes ~15-60 min to provision
# the FIRST time; gating it off would re-pay that wait on every resume (the exact gap the old
# pre-shared-cert hack bridged). Ungated + free = instant valid TLS on resume, at $0.
#
# GOOGLE-MANAGED + DNS AUTHORIZATION (keyless — matches the stack's no-exported-credentials
# posture): no PEM/key material is ever handled. Google issues and auto-renews the cert once a
# CNAME (emitted as the dns_authorization_cname_* outputs) exists in the Spaceship DNS zone.
# Because the app's domain is on Spaceship (not Cloud DNS), that CNAME cannot be managed by the
# hashicorp/google provider. The namecheap/spaceship provider exists but (as of v0.5.5) its
# record validator rejects known-after-apply values — and this CNAME's target is a reference to
# the dns_authorization resource above — so it cannot manage it either. Instead run.sh's
# update_dns (lib/dns.sh → ensure_cert_cname) asserts it idempotently on every apply/resume from
# these outputs, so it self-heals and needs no manual step. After it
# resolves, the cert provisions and then persists forever — DNS-auth certs renew automatically as
# long as the CNAME stays in place (which update_dns guarantees; it is upserted, never pruned),
# independent of any suspend/resume of the cluster. See infra/docs/08-gcp-bootstrap.md §7.

# DNS authorization — Google emits a CNAME target the operator adds to the Spaceship zone once.
# The domain is fixed at plan time (var.app_domain), so this is stable across applies.
resource "google_certificate_manager_dns_authorization" "app" {
  name        = "${local.name_prefix}-dnsauth"
  domain      = var.app_domain
  description = "DNS authorization for the ${var.app_domain} Google-managed cert (Gateway TLS)."
  labels      = local.common_labels

  # certificatemanager.googleapis.com is eventually consistent after enable: a fresh project
  # 403s with SERVICE_DISABLED for minutes even after google_project_service returns. Chain off
  # the api_propagation sleep so these build only once the API is usable (same guard the Valkey
  # instance uses). The cert + map-entry inherit this ordering via their references below.
  depends_on = [time_sleep.api_propagation]
}

# The Google-managed certificate for the app domain, authorized by the DNS authorization above.
# managed {} with dns_authorizations = keyless issuance; no private key touches Terraform/state.
resource "google_certificate_manager_certificate" "app" {
  name        = "${local.name_prefix}-cert"
  description = "Google-managed TLS cert for ${var.app_domain} (Gateway, survives suspend)."
  labels      = local.common_labels

  managed {
    domains            = [var.app_domain]
    dns_authorizations = [google_certificate_manager_dns_authorization.app.id]
  }
}

# Certificate map + entry — the Gateway references the MAP by name via the
# networking.gke.io/certmap annotation (see overlays/gcp). The entry binds the cert to the
# hostname; a primary entry (matching the served host) is what the LB serves for that SNI.
resource "google_certificate_manager_certificate_map" "app" {
  name        = "${local.name_prefix}-certmap"
  description = "Cert map referenced by the GKE Gateway (networking.gke.io/certmap)."
  labels      = local.common_labels

  # See dns_authorization above — same SERVICE_DISABLED propagation guard. The map has no
  # reference to the DNS auth, so it needs the depends_on independently. The map-entry chains
  # off this map (and the cert) by reference, so it inherits the ordering.
  depends_on = [time_sleep.api_propagation]
}

resource "google_certificate_manager_certificate_map_entry" "app" {
  name         = "${local.name_prefix}-certmap-entry"
  map          = google_certificate_manager_certificate_map.app.name
  certificates = [google_certificate_manager_certificate.app.id]
  hostname     = var.app_domain
  description  = "Serve the app cert for ${var.app_domain}."
  labels       = local.common_labels
}
