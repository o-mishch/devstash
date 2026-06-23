import { describe, expect, it } from 'vitest'
import { SIGNED_URL_EXPIRY_BUFFER_MS, computeSignedUrlStaleTime } from './signed-url-ttl'

describe('computeSignedUrlStaleTime', () => {
  const fetchedAt = 1_000_000_000_000

  it('returns 0 when there is no expiry (no data yet)', () => {
    expect(computeSignedUrlStaleTime(undefined, fetchedAt)).toBe(0)
  })

  it('returns 0 for an unparseable expiry', () => {
    expect(computeSignedUrlStaleTime('not-a-date', fetchedAt)).toBe(0)
  })

  it('keeps the URL fresh until buffer-before-expiry', () => {
    const tenMinutes = 10 * 60 * 1000
    const expiresAt = new Date(fetchedAt + tenMinutes).toISOString()
    expect(computeSignedUrlStaleTime(expiresAt, fetchedAt)).toBe(tenMinutes - SIGNED_URL_EXPIRY_BUFFER_MS)
  })

  it('clamps to 0 when the URL is already within the expiry buffer', () => {
    const expiresAt = new Date(fetchedAt + SIGNED_URL_EXPIRY_BUFFER_MS - 1).toISOString()
    expect(computeSignedUrlStaleTime(expiresAt, fetchedAt)).toBe(0)
  })

  it('clamps to 0 for an already-expired URL', () => {
    const expiresAt = new Date(fetchedAt - 60_000).toISOString()
    expect(computeSignedUrlStaleTime(expiresAt, fetchedAt)).toBe(0)
  })
})
