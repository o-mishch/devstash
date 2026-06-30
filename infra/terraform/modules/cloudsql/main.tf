# Cloud SQL for PostgreSQL — the managed database for the GKE deploy.
#
# Dual networking:
#   - PRIVATE IP — the app/GKE pods connect over the VPC peering (Private Services
#     Access from the network module). No allowlist, lowest latency. This is the
#     URL the app reads (outputs.database_url).
#   - PUBLIC IP — for DIRECT developer access (psql/GUI from a laptop). Locked to
#     var.authorized_networks (an IP allowlist); TLS required by ssl_mode = ENCRYPTED_ONLY.

resource "google_sql_database_instance" "postgres" {
  name             = "${var.name_prefix}-pg"
  database_version = "POSTGRES_16"
  region           = var.region

  # Two independent deletion guards — each operates at a different layer.
  # Both must be disabled (apply) before a destroy can succeed.
  #
  # deletion_protection (Terraform provider-level, bool):
  #   Terraform refuses to issue a GCP delete call. Set false + apply first.
  #
  # settings.deletion_protection_enabled (GCP API-level, bool):
  #   Maps to REST API field settings.deletionProtectionEnabled. Blocks deletion
  #   across ALL surfaces: Console, gcloud CLI, REST API, and Terraform. This is
  #   the toggle shown in the Cloud Console as "Instance deletion prevention".
  #   Set false + apply — if still true, GCP rejects the delete regardless of the
  #   Terraform-level guard above.
  #
  # Teardown order: set both to false + apply, then destroy.
  deletion_protection = var.deletion_protection

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
    # GCP API-level deletion guard (see deletion_protection / deletion_policy comments
    # above). Must be set false + applied before a destroy can succeed at the GCP layer.
    deletion_protection_enabled = var.deletion_protection
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
      #      (devstash-database-ca-cert). No client cert, key, or client-CA secret
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
      enabled                        = true
      point_in_time_recovery_enabled = true
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

resource "google_sql_database" "devstash" {
  name     = "devstash"
  instance = google_sql_database_instance.postgres.name
}

# App DB user. The password is generated and stored in Secret Manager (iam module
# wires the app's access); never hardcode it.
resource "google_sql_user" "app" {
  name     = "devstash_app"
  instance = google_sql_database_instance.postgres.name
  password = var.app_user_password
}
