# Cloud SQL for PostgreSQL — the managed database for the GKE deploy.
#
# Dual networking:
#   - PRIVATE IP — the app/GKE pods connect over the VPC peering (Private Services
#     Access from the network module). No allowlist, lowest latency. This is the
#     URL the app reads (outputs.database_url).
#   - PUBLIC IP — for DIRECT developer access (psql/GUI from a laptop). Locked to
#     var.authorized_networks (an IP allowlist); TLS required by ssl_mode = ENCRYPTED_ONLY.

resource "google_sql_database_instance" "postgres" {
  # Cost toggle. Unlike the old stop-only model (activation_policy=NEVER kept the disk
  # for ~$1.70/mo), the deep suspend DESTROYS the instance for true ~$0 idle. The data
  # is preserved out-of-band: run.sh suspend runs `gcloud sql export` to the GCS dump
  # bucket and verifies it BEFORE flipping instance_active=false; run.sh resume recreates
  # this instance and `gcloud sql import`s the dump. A count→0 destroy reads
  # deletion_protection from PRIOR state, so the instance must be unprotected to be
  # destroyable in a single apply (see deletion_protection below).
  count            = var.instance_active ? 1 : 0
  name             = "${var.name_prefix}-pg"
  database_version = "POSTGRES_16"
  region           = var.region

  # deletion_protection is DELIBERATELY false here (both the Terraform-level and the
  # GCP API-level guard, settings.deletion_protection_enabled below), mirroring the GKE
  # cluster: this instance is torn down and recreated on every deep suspend/resume cycle,
  # and a count→0 destroy reads deletion_protection from prior state — a protected
  # instance could not be suspended in a single apply. Data safety is NOT provided by
  # this flag anymore; it is provided by the verified GCS dump that run.sh suspend takes
  # before it ever sets instance_active=false. Do NOT re-enable protection expecting the
  # old stop-not-destroy safety — that model is gone.
  deletion_protection = false

  lifecycle {
    # Guard against accidentally exposing the database to the whole internet.
    # A 0.0.0.0/0 CIDR in authorized_networks would make the public IP reachable
    # from anywhere — reject it at plan time instead of silently creating the risk.
    precondition {
      condition     = !contains([for n in var.authorized_networks : n.value], "0.0.0.0/0")
      error_message = "Do not add 0.0.0.0/0 to db_authorized_networks — it exposes the public IP to the entire internet."
    }
  }

  settings {
    tier = var.tier
    # ALWAYS = running; NEVER = stopped (no vCPU/RAM charge, disk kept). Only matters while
    # the instance EXISTS (instance_active=true): the event-driven auto-suspend flips it to
    # NEVER to stop the DB without destroying it (~$1.70/mo disk). The deep suspend destroys
    # the instance via count instead (see the count comment above), so this value is
    # irrelevant on that path.
    activation_policy = var.activation_policy
    # GCP API-level deletion guard — false for the same reason as the Terraform-level
    # deletion_protection above (the instance is destroyed every deep-suspend cycle).
    deletion_protection_enabled = false
    # Explicitly set ENTERPRISE so the GCP API doesn't default to ENTERPRISE_PLUS.
    # ENTERPRISE_PLUS only accepts db-perf-optimized-N-* tiers; shared-core db-f1-micro
    # is rejected with "Invalid Tier for ENTERPRISE_PLUS Edition" if omitted and an
    # org/project-level policy defaults new instances to ENTERPRISE_PLUS.
    edition           = "ENTERPRISE"
    availability_type = var.highly_available ? "REGIONAL" : "ZONAL" # REGIONAL = failover replica
    disk_type         = "PD_SSD"
    disk_size         = 10
    disk_autoresize   = true

    ip_configuration {
      # Only provision a PUBLIC IP when at least one developer CIDR is allowlisted.
      # With an empty allowlist the instance is private-only (app reaches it in-VPC) —
      # no public endpoint exists at all, the smallest attack surface. Add a CIDR to
      # db_authorized_networks to turn the public IP on for direct psql/GUI access.
      ipv4_enabled    = length(var.authorized_networks) > 0
      private_network = var.network_id # always private — the app reaches it in-VPC
      # ── ssl_mode: ENCRYPTED_ONLY — authoritative rationale, do not change ──────
      #
      # Official GCP documentation (cloud.google.com/sql/docs/postgres/configure-ssl-instance)
      # defines the three Cloud SQL ssl_mode values for PostgreSQL as follows:
      #
      #   ALLOW_UNENCRYPTED_AND_ENCRYPTED
      #     "Allows non-SSL/non-TLS and SSL/TLS connections. The client certificate
      #      isn't verified for SSL/TLS connections." — never use in production.
      #
      #   ENCRYPTED_ONLY  ← THIS PROJECT USES THIS
      #     "Only allows connections encrypted with SSL/TLS. The client certificate
      #      isn't verified for SSL connections."
      #     Client certificates are NOT required. Encryption is mandatory.
      #
      #   TRUSTED_CLIENT_CERTIFICATE_REQUIRED
      #     "Only allows connections encrypted with SSL/TLS AND with valid client
      #      certificates." — requires each client to present a cert signed by the
      #      Cloud SQL CA. Connections without a client cert are rejected.
      #
      # Why ENCRYPTED_ONLY is the only correct choice for this stack:
      #
      #   1. CONNECTION URL: outputs.tf builds `?sslmode=require` (encrypt; no client
      #      cert field in the URL). Under TRUSTED_CLIENT_CERTIFICATE_REQUIRED, Cloud
      #      SQL rejects this immediately — the handshake fails before auth.
      #
      #   2. APP-LAYER SERVER CA VERIFICATION: server identity IS verified, but by
      #      the application, not the instance. node-postgres receives DATABASE_CA_CERT
      #      (the Google-managed Cloud SQL server CA from Secret Manager) and calls
      #      tls.connect({ ca, rejectUnauthorized: true }) — see resolveDbSsl() in
      #      src/lib/infra/db-local.ts. This is equivalent to sslmode=verify-ca.
      #      ENCRYPTED_ONLY + app-layer CA pin = encryption + server identity check.
      #
      #   3. NO CLIENT CERT MATERIAL EXISTS: Secret Manager holds only the server CA
      #      (the database-ca-cert property of devstash-app-config). No client cert, key, or client-CA secret
      #      exists. Switching to TRUSTED_CLIENT_CERTIFICATE_REQUIRED without first
      #      completing ALL of the following steps will break every Cloud SQL connection:
      #        a. gcloud sql ssl client-certs create devstash-app client.crt \
      #               --instance=${var.name_prefix}-pg
      #        b. Store cert+key+client-ca in three new Secret Manager secrets
      #        c. Add three new entries to ESO ExternalSecret (external-secrets.yaml)
      #        d. Update resolveDbSsl() in db-local.ts to pass { cert, key, ca }
      #
      # DO NOT change ssl_mode to TRUSTED_CLIENT_CERTIFICATE_REQUIRED unless all
      # four steps above are complete. This value has been changed back and forth
      # by automated agents — ENCRYPTED_ONLY is intentional and correct.
      ssl_mode = "ENCRYPTED_ONLY"

      # Allowlist of CIDRs permitted to reach the PUBLIC IP (developer machines).
      # Empty by default → ipv4_enabled=false, so no public IP exists. Adding a CIDR
      # both provisions the public endpoint and restricts it to that allowlist.
      dynamic "authorized_networks" {
        for_each = var.authorized_networks
        content {
          name  = authorized_networks.value.name
          value = authorized_networks.value.value
        }
      }
    }

    backup_configuration {
      # Backups are gated by var.backups_enabled. Off for the dev showcase: durability
      # comes from the suspend-time GCS dump (run.sh suspend → `gcloud sql export`), not
      # from Cloud SQL's own backups, so paying for daily backup storage is redundant
      # here. Keep them ON for prod (set backups_enabled = true). PITR (continuous WAL
      # archiving) can only be on when backups are on — it is forced off otherwise.
      enabled                        = var.backups_enabled
      point_in_time_recovery_enabled = var.backups_enabled ? var.point_in_time_recovery : false
      start_time                     = "03:00"
    }

    database_flags {
      # db-f1-micro real limit is ~25 connections (RAM-based; Cloud SQL ignores the
      # flag value and enforces its own ceiling on shared-core instances). Setting 25
      # here documents the actual ceiling and prevents confusion with the default 100.
      # Raise this only if you upgrade to a dedicated-core tier (db-n1-standard-*+).
      #
      # IMPORTANT: DB_POOL_MAX in infra/k8s/overlays/gcp/kustomization.yaml is sized
      # against this ceiling: maxReplicas(10) × DB_POOL_MAX(2) = 20 ≤ 25.
      # If you upgrade the tier, recalculate DB_POOL_MAX:
      #   new_pool_max = floor((new_max_connections - 5_headroom) / maxReplicas)
      # and update the literal in the GCP overlay's configMapGenerator.
      name  = "max_connections"
      value = "25"
    }

    user_labels = var.labels
  }
}

# Count-gated with the instance: both vanish on deep suspend and are recreated (empty)
# on resume, at which point run.sh imports the GCS dump back into this database.
resource "google_sql_database" "devstash" {
  count    = var.instance_active ? 1 : 0
  name     = "devstash"
  instance = google_sql_database_instance.postgres[0].name
}

# App DB user. The password is generated and stored in Secret Manager (iam module
# wires the app's access); never hardcode it. The generating random_password resource
# lives in the root module and has no keepers, so the password is STABLE across a
# suspend/resume cycle — the recreated user matches the dump's object ownership and the
# database-url secret stays valid.
resource "google_sql_user" "app" {
  count    = var.instance_active ? 1 : 0
  name     = "devstash_app"
  instance = google_sql_database_instance.postgres[0].name
  password = var.app_user_password
}

# State migration: these resources gained `count` in the deep-suspend change, moving their
# addresses from `.<name>` to `.<name>[0]`. Without these blocks, an existing live instance
# would be planned as destroy-and-recreate (DATA LOSS) on the first apply after the upgrade.
# The blocks are no-ops when the old address isn't in state (fresh installs), so they are
# safe to keep permanently.
moved {
  from = google_sql_database_instance.postgres
  to   = google_sql_database_instance.postgres[0]
}
moved {
  from = google_sql_database.devstash
  to   = google_sql_database.devstash[0]
}
moved {
  from = google_sql_user.app
  to   = google_sql_user.app[0]
}
