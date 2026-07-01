# All outputs are null when the instance is deep-suspended (instance_active = false →
# count = 0). Callers that interpolate these must guard for null (see envs/dev/main.tf
# app_secrets, which only wires the database-* secrets when db_active is true).

output "instance_name" {
  value = one(google_sql_database_instance.postgres[*].name)
}

output "private_ip" {
  value     = one(google_sql_database_instance.postgres[*].private_ip_address)
  sensitive = true
}

output "connection_name" {
  value = one(google_sql_database_instance.postgres[*].connection_name)
}

# The per-instance service account Cloud SQL uses for server-side export/import
# (serviceAccountEmailAddress). This is NOT the project-level Cloud SQL agent — it is a
# per-instance identity (p<project_number>-<hash>@gcp-sa-cloud-sql...) whose hash is
# REGENERATED every time the instance is recreated (i.e. on every resume). Callers must
# grant the dump-bucket IAM to THIS value, read from the live instance, never a hardcoded
# email. Null when the instance is deep-suspended (count = 0).
output "service_account_email" {
  value = one(google_sql_database_instance.postgres[*].service_account_email_address)
}

output "database_name" {
  value = one(google_sql_database.devstash[*].name)
}

# Prisma uses a standard postgres:// URL. DATABASE_URL and DIRECT_URL point at the
# same private IP here (no separate pooler like Neon); add PgBouncer later if needed.
# The APP uses this (in-VPC private IP — no allowlist, lowest latency). Null when the
# instance is deep-suspended.
#
# sslmode=require: encrypt the channel; client does NOT present a cert. This matches
# ssl_mode = ENCRYPTED_ONLY on the instance (see main.tf). Server CA pinning is done
# in the app layer via DATABASE_CA_CERT (src/lib/infra/db-local.ts), not in the URL.
# DO NOT change to sslmode=verify-ca or verify-full here — node-postgres's `ssl.ca`
# option (set by resolveDbSsl) already enforces CA verification; adding it to the URL
# too causes a conflict (the URL sslmode is overridden by the ssl object anyway).
output "database_url" {
  value = var.instance_active ? (
    "postgresql://${google_sql_user.app[0].name}:${var.app_user_password}@${google_sql_database_instance.postgres[0].private_ip_address}:5432/${google_sql_database.devstash[0].name}?sslmode=require"
  ) : null
  sensitive = true
}

# Google-managed server CA (PEM) for the instance. The app's node-postgres adapter
# passes it as DATABASE_CA_CERT to verify the TLS chain (verify-CA). Hostname identity
# is skipped in the app (it connects by private IP, which never matches the cert CN) —
# see src/lib/infra/db-local.ts. Mirrors the Memorystore server_ca_cert wiring. Null
# when the instance is deep-suspended.
output "server_ca_cert" {
  value     = try(google_sql_database_instance.postgres[0].server_ca_cert[0].cert, null)
  sensitive = true
}

# Empty unless db_authorized_networks is set — the public IP is only provisioned then.
output "public_ip" {
  value = one(google_sql_database_instance.postgres[*].public_ip_address)
}

# For DIRECT developer access from a laptop (psql/GUI). Reachable only from an IP in
# var.authorized_networks; SSL required. NOT consumed by the app — surfaced via
# `tofu output -raw db_public_database_url` for local connections. Empty string when
# no public IP is provisioned (empty allowlist), null when deep-suspended.
output "public_database_url" {
  value = !var.instance_active ? null : (
    google_sql_database_instance.postgres[0].public_ip_address == "" ? "" : (
      "postgresql://${google_sql_user.app[0].name}:${var.app_user_password}@${google_sql_database_instance.postgres[0].public_ip_address}:5432/${google_sql_database.devstash[0].name}?sslmode=require"
    )
  )
  sensitive = true
}
