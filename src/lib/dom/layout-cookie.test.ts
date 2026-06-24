import { describe, it, expect, afterEach } from 'vitest'
import { parseLayoutCookie, readLayoutCookie, writeLayoutCookie } from './layout-cookie'

describe('parseLayoutCookie', () => {
  it('returns empty object for undefined / empty input', () => {
    expect(parseLayoutCookie(undefined)).toEqual({})
    expect(parseLayoutCookie('')).toEqual({})
  })

  it('parses a URL-encoded JSON cookie value', () => {
    const raw = encodeURIComponent(JSON.stringify({ sidebar: true }))
    expect(parseLayoutCookie(raw)).toEqual({ sidebar: true })
  })

  it('parses a plain (non-encoded) JSON cookie value', () => {
    expect(parseLayoutCookie('{"sidebar":false}')).toEqual({ sidebar: false })
  })

  it('returns empty object on malformed JSON', () => {
    expect(parseLayoutCookie('not-json')).toEqual({})
    expect(parseLayoutCookie('%7Bbroken')).toEqual({})
  })
})

describe('readLayoutCookie', () => {
  afterEach(() => {
    delete (globalThis as Record<string, unknown>).document
  })

  it('returns empty object when document is undefined (SSR)', () => {
    expect(typeof document).toBe('undefined')
    expect(readLayoutCookie()).toEqual({})
  })

  it('reads and parses the ds-layout cookie', () => {
    const encoded = encodeURIComponent(JSON.stringify({ sidebar: true }))
    ;(globalThis as Record<string, unknown>).document = {
      cookie: `other=val; ds-layout=${encoded}; another=x`,
    }
    expect(readLayoutCookie()).toEqual({ sidebar: true })
  })

  it('returns empty object when the ds-layout cookie is absent', () => {
    ;(globalThis as Record<string, unknown>).document = { cookie: 'other=val' }
    expect(readLayoutCookie()).toEqual({})
  })
})

describe('writeLayoutCookie', () => {
  afterEach(() => {
    delete (globalThis as Record<string, unknown>).document
    delete (globalThis as Record<string, unknown>).location
  })

  it('is a no-op when document is undefined (SSR)', () => {
    expect(() => writeLayoutCookie({ sidebar: true })).not.toThrow()
  })

  it('merges the patch into the existing cookie value', () => {
    const existing = encodeURIComponent(JSON.stringify({ sidebar: false }))
    let written = ''
    ;(globalThis as Record<string, unknown>).document = {
      get cookie() { return `ds-layout=${existing}` },
      set cookie(v: string) { written = v },
    }
    ;(globalThis as Record<string, unknown>).location = { protocol: 'http:' }

    writeLayoutCookie({ sidebar: true })

    const match = written.match(/ds-layout=([^;]+)/)
    expect(parseLayoutCookie(match?.[1])).toEqual({ sidebar: true })
    expect(written).not.toContain('; Secure')
  })

  it('appends the Secure flag on https', () => {
    let written = ''
    ;(globalThis as Record<string, unknown>).document = {
      get cookie() { return '' },
      set cookie(v: string) { written = v },
    }
    ;(globalThis as Record<string, unknown>).location = { protocol: 'https:' }

    writeLayoutCookie({ sidebar: false })

    expect(written).toContain('; Secure')
  })
})
