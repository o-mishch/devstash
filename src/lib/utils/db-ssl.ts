// Shared node-postgres TLS resolver — client-safe (no `server-only`, no secrets, no
// Node APIs) on purpose: both the app's runtime adapter (src/lib/infra/db-local.ts,
// which IS `server-only`) AND the standalone seed script (prisma/seed.ts, which cannot
// import a `server-only` module) need this exact policy. Keep it here as the single
// source so the two callers never drift. See infra/docs/09-gcp-audit.md R12.

// node-postgres TLS config (a subset of pg.PoolConfig.ssl / tls.ConnectionOptions).
export interface DbSslConfig {
  ca: string
  rejectUnauthorized: true
  checkServerIdentity: () => undefined
}

// Pure, exported for unit testing. Builds the node-postgres TLS config from the optional
// server CA: present (DATABASE_CA_CERT, synced from Secret Manager) → verify-CA — validate
// the chain against the Google-managed CA but skip hostname identity, since we connect over
// Cloud SQL's VPC PRIVATE IP whose address never matches the cert CN. Absent (local kind,
// no TLS) → undefined, so the adapter honors the connection URL's sslmode as-is.
//
// SSL architecture (GCP path) — read this before touching ssl_mode or sslmode:
//
//   Cloud SQL ssl_mode = ENCRYPTED_ONLY (infra/terraform/modules/cloudsql/main.tf).
//   Official GCP definition (cloud.google.com/sql/docs/postgres/configure-ssl-instance):
//     "Only allows connections encrypted with SSL/TLS. The client certificate isn't
//      verified for SSL connections."
//   → Encryption is mandatory. Client certificates are NOT required by the instance.
//
//   DATABASE_URL uses `sslmode=require` (encrypt; no client cert in URL). This is
//   valid under ENCRYPTED_ONLY. It is REJECTED under TRUSTED_CLIENT_CERTIFICATE_REQUIRED
//   (that mode requires a client cert in the TLS handshake — connection fails without one).
//
//   Server identity IS verified here, at the app layer (not by the instance):
//   `rejectUnauthorized: true` + `ca: DATABASE_CA_CERT` pins the Google-managed Cloud
//   SQL server CA (synced from Secret Manager via ESO). Equivalent to sslmode=verify-ca.
//
//   `checkServerIdentity: () => undefined` skips hostname check — the app connects
//   by private VPC IP (e.g. 10.x.x.x) which never matches the cert CN. CA chain
//   validation still runs; only hostname is suppressed.
//
//   DO NOT change ssl_mode to TRUSTED_CLIENT_CERTIFICATE_REQUIRED in Terraform unless
//   you also: (a) generate a client cert via `gcloud sql ssl client-certs create`,
//   (b) store cert+key in Secret Manager, (c) add ESO entries, and (d) pass `cert`+`key`
//   here. Without all four steps every connection fails. Full checklist in cloudsql/main.tf.
export function resolveDbSsl(caCert: string | undefined): DbSslConfig | undefined {
  if (!caCert) return undefined
  return { ca: caCert, rejectUnauthorized: true, checkServerIdentity: () => undefined }
}
