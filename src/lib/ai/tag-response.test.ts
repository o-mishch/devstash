import { describe, it, expect } from 'vitest'

import { parseTagsResponse } from '@/lib/ai/tag-response'

describe('parseTagsResponse', () => {
  it('parses the documented { tags: [...] } object shape', () => {
    expect(parseTagsResponse('{ "tags": ["React", "Hooks"] }')).toEqual(['react', 'hooks'])
  })

  it('parses a bare array shape', () => {
    expect(parseTagsResponse('["TypeScript", "Zod"]')).toEqual(['typescript', 'zod'])
  })

  it('lowercases and de-duplicates tags', () => {
    expect(parseTagsResponse('{ "tags": ["React", "react", "REACT"] }')).toEqual(['react'])
  })

  it('caps the result at 5 tags', () => {
    const input = '{ "tags": ["a", "b", "c", "d", "e"] }'
    expect(parseTagsResponse(input)).toEqual(['a', 'b', 'c', 'd', 'e'])
  })

  it('returns null for invalid JSON', () => {
    expect(parseTagsResponse('not json')).toBeNull()
  })

  it('returns null when the array exceeds the max length', () => {
    expect(parseTagsResponse('["a", "b", "c", "d", "e", "f"]')).toBeNull()
  })

  it('returns null when the shape does not match the schema', () => {
    expect(parseTagsResponse('{ "labels": ["react"] }')).toBeNull()
  })

  it('returns null when a tag is empty after trimming', () => {
    expect(parseTagsResponse('{ "tags": ["  "] }')).toBeNull()
  })
})
