import { describe, it, expect, vi, afterEach } from 'vitest'

describe('getBaseUrl', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
    vi.unstubAllGlobals()
  })

  it('returns window.location.origin in browser context', async () => {
    vi.stubGlobal('window', { location: { origin: 'https://devstash.io' } })
    const { getBaseUrl } = await import('./url')
    expect(getBaseUrl()).toBe('https://devstash.io')
  })

  it('returns NEXTAUTH_URL in server context when set', async () => {
    vi.stubGlobal('window', undefined)
    vi.stubEnv('NEXTAUTH_URL', 'https://devstash.io')
    const { getBaseUrl } = await import('./url')
    expect(getBaseUrl()).toBe('https://devstash.io')
  })

  it('falls back to localhost in server context when NEXTAUTH_URL is not set', async () => {
    vi.stubGlobal('window', undefined)
    vi.stubEnv('NEXTAUTH_URL', '')
    const { getBaseUrl } = await import('./url')
    expect(getBaseUrl()).toBe('http://localhost:3000')
  })
})
