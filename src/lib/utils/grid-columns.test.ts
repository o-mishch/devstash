import { describe, it, expect } from 'vitest'
import { getListGridColumns, getImageGridColumns } from './grid-columns'

describe('getListGridColumns', () => {
  it('returns 1 column below the sm breakpoint (mobile)', () => {
    expect(getListGridColumns(0)).toBe(1)
    expect(getListGridColumns(390)).toBe(1)
    expect(getListGridColumns(639)).toBe(1)
  })

  it('returns 2 columns between sm and lg', () => {
    expect(getListGridColumns(640)).toBe(2)
    expect(getListGridColumns(800)).toBe(2)
    expect(getListGridColumns(1023)).toBe(2)
  })

  it('returns 3 columns at lg and above', () => {
    expect(getListGridColumns(1024)).toBe(3)
    expect(getListGridColumns(1920)).toBe(3)
  })
})

describe('getImageGridColumns', () => {
  it('returns 2 columns below the lg breakpoint (mobile + tablet)', () => {
    expect(getImageGridColumns(0)).toBe(2)
    expect(getImageGridColumns(390)).toBe(2)
    expect(getImageGridColumns(639)).toBe(2)
    expect(getImageGridColumns(640)).toBe(2)
    expect(getImageGridColumns(1023)).toBe(2)
  })

  it('returns 3 columns at lg and above', () => {
    expect(getImageGridColumns(1024)).toBe(3)
    expect(getImageGridColumns(1920)).toBe(3)
  })
})
