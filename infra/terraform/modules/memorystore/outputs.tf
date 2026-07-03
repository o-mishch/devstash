locals {
  # desired_auto_created_endpoints populates `endpoints` as
  # endpoints[].connections[].psc_auto_connection[] (ip_address, port, connection_type).
  # Flatten every auto-created PSC connection across all endpoints into one list.
  valkey_conns = flatten([
    for ep in google_memorystore_instance.cache.endpoints : [
      for conn in ep.connections : conn.psc_auto_connection
    ]
  ])

  # A CLUSTER_DISABLED instance exposes a single PRIMARY connection (plus a READER when a
  # replica exists). Select the PRIMARY so the app always dials the writable endpoint;
  # fall back to the first connection if the type is not surfaced.
  valkey_primary_conns = [
    for c in local.valkey_conns : c if c.connection_type == "CONNECTION_TYPE_PRIMARY"
  ]
  valkey_conn = length(local.valkey_primary_conns) > 0 ? local.valkey_primary_conns[0] : local.valkey_conns[0]

  # Full managed-CA bundle: every PEM across all managed_server_ca[*].ca_certs[*].certificates[*],
  # not just the first. Google rotates the server CA, and during a rotation window the instance
  # can present a cert chained to a NEWER CA while the pool holds multiple CAs. Trusting the whole
  # pool (Node's tls.ca accepts a multi-PEM string) means a Google-initiated rotation never breaks
  # the app's TLS verification between tofu applies.
  valkey_ca_bundle = join("\n", flatten([
    for mca in google_memorystore_instance.cache.managed_server_ca : [
      for cc in mca.ca_certs : cc.certificates
    ]
  ]))
}

# Private PSC endpoint the app connects to (rediss://host:port). No public IP.
output "host" {
  value = local.valkey_conn.ip_address
}

output "port" {
  value = local.valkey_conn.port
}

# Google-managed server CA bundle (PEM) for the SERVER_AUTHENTICATION TLS connection. The
# app passes it to node-redis as REDIS_CA_CERT to verify Valkey's cert (rediss://).
# RedisInsight / valkey-cli also use it (--cacert) to connect from a bastion/pod. This is
# the FULL bundle (all CAs in the rotation pool, see local.valkey_ca_bundle) so a Google CA
# rotation does not break verification between applies.
#
# NOTE: no auth_string output — Valkey uses IAM AUTH (a runtime OAuth2 access token as
# the password), not a static instance password. The connecting principal is authorized
# via roles/memorystore.dbConnectionUser (granted to the app SA in the env module).
output "server_ca_cert" {
  value     = local.valkey_ca_bundle
  sensitive = true
}
