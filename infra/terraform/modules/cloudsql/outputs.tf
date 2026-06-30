output "instance_name" {
  value = google_sql_database_instance.postgres.name
}

output "private_ip" {
  value     = google_sql_database_instance.postgres.private_ip_address
  sensitive = true
}

output "connection_name" {
  value = google_sql_database_instance.postgres.connection_name
}

output "database_name" {
  value = google_sql_database.devstash.name
}

# Prisma uses a standard postgres:// URL. DATABASE_URL and DIRECT_URL point at the
# same private IP here (no separate pooler like Neon); add PgBouncer later if needed.
# The APP uses this (in-VPC private IP — no allowlist, lowest latency).
#
# sslmode=require: encrypt the channel; client does NOT present a cert. This matches
# ssl_mode = ENCRYPTED_ONLY on the instance (see main.tf). Server CA pinning is done
# in the app layer via DATABASE_CA_CERT (src/lib/infra/db-local.ts), not in the URL.
# DO NOT change to sslmode=verify-ca or verify-full here — node-postgres's `ssl.ca`
# option (set by resolveDbSsl) already enforces CA verification; adding it to the URL
# too causes a conflict (the URL sslmode is overridden by the ssl object anyway).
output "database_url" {
  value     = "postgresql://${google_sql_user.app.name}:${var.app_user_password}@${google_sql_database_instance.postgres.private_ip_address}:5432/${google_sql_database.devstash.name}?sslmode=require"
  sensitive = true
}

# Google-managed server CA (PEM) for the instance. The app's node-postgres adapter
# passes it as DATABASE_CA_CERT to verify the TLS chain (verify-CA). Hostname identity
# is skipped in the app (it connects by private IP, which never matches the cert CN) —
# see src/lib/infra/db-local.ts. Mirrors the Memorystore server_ca_cert wiring.
output "server_ca_cert" {
  value     = google_sql_database_instance.postgres.server_ca_cert[0].cert
  sensitive = true
}

# Empty unless db_authorized_networks is set — the public IP is only provisioned then.
output "public_ip" {
  value = google_sql_database_instance.postgres.public_ip_address
}

# For DIRECT developer access from a laptop (psql/GUI). Reachable only from an IP in
# var.authorized_networks; SSL required. NOT consumed by the app — surfaced via
# `tofu output -raw db_public_database_url` for local connections. Empty string when
# no public IP is provisioned (empty allowlist), so it never yields a hostless URL.
output "public_database_url" {
  value = google_sql_database_instance.postgres.public_ip_address == "" ? "" : (
    "postgresql://${google_sql_user.app.name}:${var.app_user_password}@${google_sql_database_instance.postgres.public_ip_address}:5432/${google_sql_database.devstash.name}?sslmode=require"
  )
  sensitive = true
}
