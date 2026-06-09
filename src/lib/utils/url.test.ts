import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { getDownloadUrl } from '@/lib/utils/url'

describe('getDownloadUrl', () => {
  const originalNextAuthUrl = process.env.NEXTAUTH_URL

  beforeEach(() => {
    process.env.NEXTAUTH_URL = 'https://app.example.com'
  })

  afterEach(() => {
    process.env.NEXTAUTH_URL = originalNextAuthUrl
  })

  it('returns a relative download path by default', () => {
    expect(getDownloadUrl('item-1')).toBe('/api/download/item-1')
  })

  it('returns an absolute download path when requested', () => {
    expect(getDownloadUrl('item-1', true)).toBe('https://app.example.com/api/download/item-1')
  })

  it('appends preview query param for preview URLs', () => {
    expect(getDownloadUrl('item-1', { preview: true })).toBe('/api/download/item-1?preview=1')
    expect(getDownloadUrl('item-1', { absolute: true, preview: true }))
      .toBe('https://app.example.com/api/download/item-1?preview=1')
  })
})
