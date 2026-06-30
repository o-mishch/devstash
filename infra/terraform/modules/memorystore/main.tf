# Memorystore for Redis — replaces Upstash on GKE. Used for rate limiting + the Pro
# entitlement cache. Private IP on our VPC via the same PSA peering.
#
# The app connects NATIVELY over TCP via ioredis (no SRH proxy), gated by REDIS_URL
# (src/lib/infra/redis-tcp.ts). On Vercel REDIS_URL is unset → the app keeps the
# Upstash REST client unchanged. AUTH on + in-transit TLS (SERVER_AUTHENTICATION) →
# a rediss://default:<auth>@host:port URL plus the Google-managed server CA
# (outputs.server_ca_cert → REDIS_CA_CERT, which ioredis uses to verify the cert).
# The local kind run uses the same ioredis path against plain redis (no TLS).

resource "google_redis_instance" "cache" {
  name = "${var.name_prefix}-redis"
  # BASIC = single node, no replica — node failure means data loss (rate-limit state reset).
  # STANDARD_HA = primary + failover replica, ~$20/mo extra. Recommended for production.
  # Set highly_available = true in terraform.tfvars to enable STANDARD_HA.
  tier           = var.highly_available ? "STANDARD_HA" : "BASIC"
  memory_size_gb = var.memory_size_gb
  region         = var.region

  authorized_network = var.network_id
  connect_mode       = "PRIVATE_SERVICE_ACCESS" # uses the VPC peering range

  # Redis 7.2, reached by ioredis (RESP2/3) over TLS. AUTH token + in-transit
  # encryption with server authentication (Google-managed per-instance CA), so the
  # app connects with rediss:// and verifies the server CA (REDIS_CA_CERT).
  redis_version           = "REDIS_7_2"
  auth_enabled            = true                    # require AUTH token
  transit_encryption_mode = "SERVER_AUTHENTICATION" # in-transit TLS → rediss://

  labels = var.labels
}
