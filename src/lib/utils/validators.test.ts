import { describe, it, expect } from 'vitest'
import { optionalUrlSchema, itemFormBaseSchema, itemMutationSchema } from '@/lib/utils/validators'

describe('optionalUrlSchema', () => {
  it('accepts an empty string', () => {
    expect(optionalUrlSchema.safeParse('').success).toBe(true)
  })

  it('accepts a URL-shaped value', () => {
    expect(optionalUrlSchema.safeParse('https://example.com').success).toBe(true)
    expect(optionalUrlSchema.safeParse('http://example.com/path?q=1').success).toBe(true)
  })

  it('rejects a plain (non-URL) string', () => {
    const result = optionalUrlSchema.safeParse('not a url')
    expect(result.success).toBe(false)
    if (!result.success) {
      expect(result.error.issues[0]?.message).toBe('Must be a valid URL')
    }
  })
})

describe('itemFormBaseSchema.url', () => {
  const base = { title: 'My link', collectionIds: [] }

  it('allows an omitted/empty url (presence is gated per item-type)', () => {
    expect(itemFormBaseSchema.safeParse(base).success).toBe(true)
    expect(itemFormBaseSchema.safeParse({ ...base, url: '' }).success).toBe(true)
  })

  it('accepts a valid url', () => {
    expect(itemFormBaseSchema.safeParse({ ...base, url: 'https://example.com' }).success).toBe(true)
  })

  it('rejects a non-url string', () => {
    expect(itemFormBaseSchema.safeParse({ ...base, url: 'just-text' }).success).toBe(false)
  })
})

describe('itemMutationSchema.url', () => {
  it('normalizes empty url to null', () => {
    const result = itemMutationSchema.safeParse({ title: 'x', url: '' })
    expect(result.success).toBe(true)
    if (result.success) expect(result.data.url).toBeNull()
  })

  it('trims and keeps a valid url', () => {
    const result = itemMutationSchema.safeParse({ title: 'x', url: '  https://example.com  ' })
    expect(result.success).toBe(true)
    if (result.success) expect(result.data.url).toBe('https://example.com')
  })

  it('rejects a non-url string', () => {
    expect(itemMutationSchema.safeParse({ title: 'x', url: 'nope' }).success).toBe(false)
  })
})

describe('optionalUrlSchema — protocol guard', () => {
  it('rejects ftp:// URLs', () => {
    expect(optionalUrlSchema.safeParse('ftp://example.com').success).toBe(false)
  })

  it('rejects javascript: URLs (XSS vector)', () => {
    expect(optionalUrlSchema.safeParse('javascript:alert(1)').success).toBe(false)
  })

  it('rejects data: URLs', () => {
    expect(optionalUrlSchema.safeParse('data:text/html,<h1>x</h1>').success).toBe(false)
  })
})

describe('itemMutationSchema.url — protocol guard', () => {
  it('rejects ftp:// URLs', () => {
    expect(itemMutationSchema.safeParse({ title: 'x', url: 'ftp://example.com' }).success).toBe(false)
  })

  it('rejects javascript: URLs (XSS vector)', () => {
    expect(itemMutationSchema.safeParse({ title: 'x', url: 'javascript:alert(1)' }).success).toBe(false)
  })
})
