import { describe, it, expect } from 'vitest'
import { formatDate, cn } from './index'

describe('cn', () => {
  it('merges class names', () => {
    expect(cn('a', 'b')).toBe('a b')
  })

  it('resolves tailwind conflicts', () => {
    expect(cn('p-2', 'p-4')).toBe('p-4')
  })
})

describe('formatDate', () => {
  it('formats a date as "Mon D"', () => {
    const date = new Date('2024-01-15')
    expect(formatDate(date)).toBe('Jan 15')
  })
})
