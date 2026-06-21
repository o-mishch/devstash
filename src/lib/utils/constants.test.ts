import { describe, expect, it } from 'vitest'
import { dominantTypeColor, SYSTEM_TYPE_COLORS } from '@/lib/utils/constants'

describe('dominantTypeColor', () => {
  it('returns null for an empty list', () => {
    expect(dominantTypeColor([])).toBeNull()
  })

  it('returns the color of the only type present', () => {
    expect(dominantTypeColor(['note', 'note', 'note'])).toBe(SYSTEM_TYPE_COLORS.note)
  })

  it('picks the most common type when types are mixed', () => {
    expect(dominantTypeColor(['snippet', 'note', 'note', 'link'])).toBe(SYSTEM_TYPE_COLORS.note)
  })

  it('breaks ties by SYSTEM_TYPE_ORDER (snippet before note)', () => {
    expect(dominantTypeColor(['note', 'snippet'])).toBe(SYSTEM_TYPE_COLORS.snippet)
  })

  it('returns null for an unknown type name', () => {
    expect(dominantTypeColor(['mystery'])).toBeNull()
  })
})
