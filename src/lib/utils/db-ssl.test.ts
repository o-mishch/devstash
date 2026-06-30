import { describe, it, expect } from 'vitest'
import { resolveDbSsl } from './db-ssl'

// resolveDbSsl builds the node-postgres TLS config shared by the app's runtime adapter
// (src/lib/infra/db-local.ts) and the seed script (prisma/seed.ts). On GCP the server CA
// (DATABASE_CA_CERT, synced from Secret Manager) is pinned for verify-CA; locally (kind,
// no TLS) it is unset so the adapter falls back to the connection URL's sslmode.
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
