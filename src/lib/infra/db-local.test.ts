import { describe, it, expect } from 'vitest'
import { resolveDbPoolMax, resolveDbSsl } from './db-local'

// resolveDbPoolMax bounds each pod's node-postgres pool so `maxReplicas * pool` stays
// under the managed Postgres max_connections (Cloud SQL dev = 100). The GKE overlay
// sets DB_POOL_MAX=5 (10 replicas * 5 = 50, with headroom for the migrate Job).
describe('resolveDbPoolMax', () => {
  it('defaults to 5 when unset', () => {
    expect(resolveDbPoolMax(undefined)).toBe(5)
  })

  it('honors a valid positive override', () => {
    expect(resolveDbPoolMax('8')).toBe(8)
    expect(resolveDbPoolMax('1')).toBe(1)
  })

  it('falls back to the default for non-positive or non-numeric values', () => {
    expect(resolveDbPoolMax('0')).toBe(5)
    expect(resolveDbPoolMax('-3')).toBe(5)
    expect(resolveDbPoolMax('abc')).toBe(5)
    expect(resolveDbPoolMax('')).toBe(5)
  })
})

// resolveDbSsl builds the node-postgres TLS config. On GKE the server CA (DATABASE_CA_CERT,
// synced from Secret Manager) is pinned for verify-CA; locally (kind, no TLS) it is unset so
// the adapter falls back to the connection URL's sslmode.
describe('resolveDbSsl', () => {
  it('returns undefined when no CA cert is set (local kind / Vercel)', () => {
    expect(resolveDbSsl(undefined)).toBeUndefined()
    expect(resolveDbSsl('')).toBeUndefined()
  })

  it('builds a verify-CA config from a PEM (verify chain, skip hostname)', () => {
    const pem = '-----BEGIN CERTIFICATE-----\nMIIB...\n-----END CERTIFICATE-----'
    const ssl = resolveDbSsl(pem)
    expect(ssl).toEqual({
      ca: pem,
      rejectUnauthorized: true,
      checkServerIdentity: expect.any(Function),
    })
    // Hostname identity is intentionally skipped (private-IP cert CN never matches),
    // so checkServerIdentity reports no error while the chain is still verified.
    expect(ssl?.checkServerIdentity()).toBeUndefined()
  })
})
