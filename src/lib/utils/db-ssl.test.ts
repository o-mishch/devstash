import { describe, it, expect } from 'vitest'
import { resolveDbSsl, stripSslModeParam } from './db-ssl'

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

// stripSslModeParam removes the `sslmode` query param that pg-connection-string would
// otherwise parse into a conflicting SSL config alongside the explicit `ssl` object built
// by resolveDbSsl — see the call sites in db-local.ts and prisma/seed.ts for the failure
// this fixes (P1011 TlsConnectionError despite a verified-correct pinned CA).
describe('stripSslModeParam', () => {
  it('passes through undefined unchanged (local kind, no CA pinning)', () => {
    expect(stripSslModeParam(undefined)).toBeUndefined()
  })

  it('removes sslmode while preserving the rest of the connection string', () => {
    const url = 'postgresql://user:pass@172.30.0.3:5432/devstash?sslmode=require'
    expect(stripSslModeParam(url)).toBe('postgresql://user:pass@172.30.0.3:5432/devstash')
  })

  it('leaves other query params intact', () => {
    const url = 'postgresql://user:pass@172.30.0.3:5432/devstash?sslmode=require&schema=public'
    expect(stripSslModeParam(url)).toBe('postgresql://user:pass@172.30.0.3:5432/devstash?schema=public')
  })

  it('is a no-op when sslmode is absent', () => {
    const url = 'postgresql://user:pass@172.30.0.3:5432/devstash'
    expect(stripSslModeParam(url)).toBe(url)
  })

  it('passes through an empty string unchanged (falsy, no parse attempted)', () => {
    expect(stripSslModeParam('')).toBe('')
  })

  it('throws a clear, named-context error on a malformed connection string', () => {
    expect(() => stripSslModeParam('not-a-valid-url')).toThrow(
      'stripSslModeParam: connection string is not a valid URL',
    )
  })
})
