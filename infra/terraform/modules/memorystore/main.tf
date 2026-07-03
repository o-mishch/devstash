# Memorystore for Valkey — replaces Upstash on GKE. Used for rate limiting + the Pro
# entitlement cache. Reached over a PRIVATE endpoint on our VPC via Private Service
# Connect (the network module owns the PSC subnet + service connection policy).
#
# The app connects NATIVELY over TCP via node-redis (no SRH proxy), gated by REDIS_URL
# (src/lib/infra/redis-tcp.ts). On Vercel REDIS_URL is unset → the app keeps the Upstash
# REST client unchanged. IAM AUTH + in-transit TLS (SERVER_AUTHENTICATION): the app
# connects to a rediss://host:port URL, authenticates with the AUTH username "default"
# and a short-lived Google OAuth2 access token as the password (fetched at runtime via
# Workload Identity — no static secret), and verifies the Google-managed server CA
# (outputs.server_ca_cert → REDIS_CA_CERT). The local kind run uses the same node-redis
# path against plain valkey (no TLS, no IAM).
#
# WHY VALKEY (not the Redis-branded product): Valkey is the actively-developed, BSD-
# licensed engine Google steers new deployments to; Memorystore for Redis is in
# maintenance. Valkey is 100% RESP-compatible, so the node-redis client is unchanged.

resource "google_memorystore_instance" "cache" {
  instance_id = "${var.name_prefix}-valkey"
  location    = var.region

  # CLUSTER_DISABLED = a single, non-clustered shard — the drop-in shape for our simple
  # rate-limit/cache use (no cross-slot keys, no cluster client needed). replica_count 0
  # is single-node (node failure resets the disposable rate-limit state); 1 adds a
  # failover replica (~HA). Toggle via highly_available in terraform.tfvars.
  mode          = "CLUSTER_DISABLED"
  shard_count   = 1
  replica_count = var.highly_available ? 1 : 0

  # SHARED_CORE_NANO is the smallest/cheapest node — right for the dev $0-posture
  # showcase. Bump to STANDARD_SMALL+ for production throughput.
  node_type = var.node_type

  # Valkey 9.0 — newest GA engine on Memorystore, reached by node-redis (RESP2/3) over TLS.
  engine_version = "VALKEY_9_0"

  # IAM AUTH: clients present a Google IAM access token (AUTH "default" <token>) instead
  # of a static password. The app SA is granted roles/memorystore.dbConnectionUser in the
  # env module. In-transit TLS with server authentication (Google-managed per-instance
  # CA) → the app connects with rediss:// and verifies the server CA (REDIS_CA_CERT).
  authorization_mode      = "IAM_AUTH"
  transit_encryption_mode = "SERVER_AUTHENTICATION"

  # PSC service-connectivity automation: the instance auto-creates its PSC connections
  # (forwarding rules) with IPs drawn from the network module's PSC subnet, governed by
  # the gcp-memorystore service connection policy (wired via depends_on in the env
  # module). desired_auto_created_endpoints is the current block (the provider deprecates
  # the older desired_psc_auto_connections in favour of it); it populates the `endpoints`
  # attribute the outputs read. network takes the full projects/<p>/global/networks/<n>
  # form — google_compute_network.id already has exactly that shape, so var.network_id is
  # passed straight in.
  desired_auto_created_endpoints {
    network    = var.network_id
    project_id = var.project_id
  }

  # Dev suspend/resume tears the whole env down and back up, so a protected instance
  # could not be count→0 destroyed in a single apply. Data is disposable cache state; no
  # protection needed. Set true for a prod env you keep standing.
  deletion_protection_enabled = false

  labels = var.labels
}
