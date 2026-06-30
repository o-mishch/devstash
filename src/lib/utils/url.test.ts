import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { getDownloadUrl, getInitialTypeFromPathname, getCollectionIdFromPathname } from '@/lib/utils/url'

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

describe('getInitialTypeFromPathname', () => {
  const itemTypes = [{ name: 'snippet' }, { name: 'note' }, { name: 'command' }]

  it('resolves the item type from a plural /items/:type path', () => {
    expect(getInitialTypeFromPathname('/items/snippets', itemTypes)).toBe('snippet')
    expect(getInitialTypeFromPathname('/items/notes', itemTypes)).toBe('note')
  })

  it('returns undefined for a non-matching path or unknown type', () => {
    expect(getInitialTypeFromPathname('/items/unknowns', itemTypes)).toBeUndefined()
    expect(getInitialTypeFromPathname('/dashboard', itemTypes)).toBeUndefined()
    expect(getInitialTypeFromPathname('/items/snippets/extra', itemTypes)).toBeUndefined()
  })
})

describe('getCollectionIdFromPathname', () => {
  it('extracts the id from a /collections/:id path', () => {
    expect(getCollectionIdFromPathname('/collections/abc123')).toBe('abc123')
  })

  it('returns undefined for non-collection or nested paths', () => {
    expect(getCollectionIdFromPathname('/collections')).toBeUndefined()
    expect(getCollectionIdFromPathname('/collections/abc/items')).toBeUndefined()
    expect(getCollectionIdFromPathname('/dashboard')).toBeUndefined()
  })
})

