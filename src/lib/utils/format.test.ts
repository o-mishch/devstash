import { describe, it, expect } from 'vitest'
import { itemCountLabel, pluralize } from '@/lib/utils/format'

describe('pluralize', () => {
  it('returns the singular form for one', () => {
    expect(pluralize(1, 'item')).toBe('item')
  })

  it('appends "s" by default for zero and many', () => {
    expect(pluralize(0, 'item')).toBe('items')
    expect(pluralize(3, 'item')).toBe('items')
  })

  it('uses an explicit plural override when given', () => {
    expect(pluralize(2, 'entry', 'entries')).toBe('entries')
    expect(pluralize(1, 'entry', 'entries')).toBe('entry')
  })
})

describe('itemCountLabel', () => {
  it('uses the plural form for zero', () => {
    expect(itemCountLabel(0)).toBe('0 items')
  })

  it('uses the singular form for one', () => {
    expect(itemCountLabel(1)).toBe('1 item')
  })

  it('uses the plural form for more than one', () => {
    expect(itemCountLabel(5)).toBe('5 items')
  })
})
