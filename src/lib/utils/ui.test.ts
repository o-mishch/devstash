import { describe, it, expect } from 'vitest'
import { getListGridColumns, getImageGridColumns, cn, actionbarLabelClass } from './ui'

describe('cn', () => {
  it('merges class names', () => {
    expect(cn('a', 'b')).toBe('a b')
  })

  it('resolves tailwind conflicts', () => {
    expect(cn('p-2', 'p-4')).toBe('p-4')
  })
})

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

describe('actionbarLabelClass', () => {
  it('maps each in-range index to its threshold class, left to right', () => {
    expect(actionbarLabelClass(0)).toBe('@[230px]/actionbar:inline hidden')
    expect(actionbarLabelClass(1)).toBe('@[300px]/actionbar:inline hidden')
    expect(actionbarLabelClass(4)).toBe('@[510px]/actionbar:inline hidden')
  })

  it('clamps a negative index to the first (leftmost) class', () => {
    expect(actionbarLabelClass(-1)).toBe('@[230px]/actionbar:inline hidden')
    expect(actionbarLabelClass(-99)).toBe('@[230px]/actionbar:inline hidden')
  })

  it('clamps an index past the end to the last class', () => {
    expect(actionbarLabelClass(5)).toBe('@[510px]/actionbar:inline hidden')
    expect(actionbarLabelClass(100)).toBe('@[510px]/actionbar:inline hidden')
  })
})
