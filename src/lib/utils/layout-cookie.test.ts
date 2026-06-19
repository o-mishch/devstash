import { describe, it, expect } from 'vitest'
import { parseLayoutCookie } from './layout-cookie'

describe('parseLayoutCookie', () => {
  it('returns empty object for undefined / empty input', () => {
    expect(parseLayoutCookie(undefined)).toEqual({})
    expect(parseLayoutCookie('')).toEqual({})
  })

  it('parses a URL-encoded JSON cookie value', () => {
    const raw = encodeURIComponent(JSON.stringify({ collections: false, pinned: true, recent: false }))
    expect(parseLayoutCookie(raw)).toEqual({ collections: false, pinned: true, recent: false })
  })

  it('parses a plain (non-encoded) JSON cookie value', () => {
    expect(parseLayoutCookie('{"recent":false}')).toEqual({ recent: false })
  })

  it('returns empty object on malformed JSON', () => {
    expect(parseLayoutCookie('not-json')).toEqual({})
    expect(parseLayoutCookie('%7Bbroken')).toEqual({})
  })
})
