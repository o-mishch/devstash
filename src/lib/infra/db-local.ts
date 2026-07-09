import 'server-only'

import type { SqlDriverAdapterFactory } from '@prisma/client/runtime/client'
import { resolveDbSsl, stripSslModeParam } from '@/lib/utils/db-ssl'

// Local-development database adapter: when DB_DRIVER='pg' (set only by the local and
// GCP Kubernetes overlays), use Prisma's STANDARD node-postgres adapter (@prisma/adapter-pg)
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
// @prisma/adapter-pg is loaded with a GATED require() inside the DB_DRIVER='pg' branch —
// the local-only dependency is therefore never resolved on the Vercel/Neon path. It must be
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

// node-postgres TLS policy (verify-CA on GCP, undefined locally) lives in the shared,
// client-safe resolveDbSsl — imported above so the seed script (prisma/seed.ts), which
// can't load this `server-only` module, reuses the exact same policy. See db-ssl.ts.

export function createLocalDbAdapter(): SqlDriverAdapterFactory | null {
  if (process.env.DB_DRIVER !== 'pg') return null
  const max = resolveDbPoolMax(process.env.DB_POOL_MAX)
  // Gated, synchronous require so the local-only dep is never resolved on the Neon path
  // and `prisma` stays a sync singleton. `await import` isn't an option (sync caller).
  // oxlint-disable-next-line typescript/no-require-imports
  const { PrismaPg } = require('@prisma/adapter-pg') as typeof import('@prisma/adapter-pg')
  // verify-CA when DATABASE_CA_CERT is set (Cloud SQL); undefined locally → the adapter
  // honors the URL's sslmode (disable on kind). See resolveDbSsl above.
  const ssl = resolveDbSsl(process.env.DATABASE_CA_CERT)
  // Strip sslmode only when we're pinning our own ssl config — see stripSslModeParam.
  const connectionString = ssl ? stripSslModeParam(process.env.DATABASE_URL) : process.env.DATABASE_URL
  return new PrismaPg({ connectionString, max, ssl })
}
