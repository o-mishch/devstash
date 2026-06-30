import 'server-only'

import type { SqlDriverAdapterFactory } from '@prisma/client/runtime/client'

// Local-development database adapter: when DB_LOCAL=1 (set only by the local
// Kubernetes Secret), use Prisma's STANDARD node-postgres adapter (@prisma/adapter-pg)
// connecting straight to the in-cluster Postgres over TCP. Unlike the Neon serverless
// adapter's HTTP path, node-postgres holds a real connection, so Prisma INTERACTIVE
// TRANSACTIONS ($transaction(async tx => …)) work — which the app relies on (register,
// item ops, AI flows).
//
// Returns null in production → prisma.ts falls back to the real Neon adapter unchanged.
// This mirrors the real Neon→Cloud SQL migration (same adapter swap). Kept OUT of
// prisma.ts's main path so the production client setup stays Neon-default.
// See infra/docs/07-local-run.md.
//
// @prisma/adapter-pg is loaded with a GATED require() inside the DB_LOCAL branch — the
// local-only dependency is therefore never resolved on the Vercel/Neon path. It must be
// a synchronous require (not `await import`) because `prisma` is a sync module-level
// singleton; serverExternalPackages in next.config.ts keeps it from being bundled.
// The type-only import above is erased at compile time and loads nothing.

// Per-pod connection-pool ceiling. node-postgres defaults to a pool of 10; with the
// app running up to HPA `maxReplicas` pods plus the migrate Job, an unbounded default
// can exceed the managed Postgres `max_connections` and start refusing connections.
// The GCP dev instance is explicitly capped at 25, so its overlay sets DB_POOL_MAX=2:
// 10 pods * 2 = 20, leaving five connections for migrations/admin. The fallback of 5
// is for other self-hosted environments and must not silently replace the GCP override.
const DEFAULT_DB_POOL_MAX = 5

// Pure, exported for unit testing (the adapter itself wraps a native dep that can't be
// constructed in a test). Falls back to the default for unset/non-positive/non-numeric.
export function resolveDbPoolMax(raw: string | undefined): number {
  const parsed = Number(raw)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_DB_POOL_MAX
}

// node-postgres TLS config (a subset of pg.PoolConfig.ssl / tls.ConnectionOptions).
interface DbSslConfig {
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

export function createLocalDbAdapter(): SqlDriverAdapterFactory | null {
  if (process.env.DB_LOCAL !== '1') return null
  const max = resolveDbPoolMax(process.env.DB_POOL_MAX)
  // Gated, synchronous require so the local-only dep is never resolved on the Neon path
  // and `prisma` stays a sync singleton. `await import` isn't an option (sync caller).
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { PrismaPg } = require('@prisma/adapter-pg') as typeof import('@prisma/adapter-pg')
  // verify-CA when DATABASE_CA_CERT is set (Cloud SQL); undefined locally → the adapter
  // honors the URL's sslmode (disable on kind). See resolveDbSsl above.
  const ssl = resolveDbSsl(process.env.DATABASE_CA_CERT)
  return new PrismaPg({ connectionString: process.env.DATABASE_URL, max, ssl })
}
