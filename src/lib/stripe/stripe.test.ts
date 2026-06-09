import { describe, it, expect } from 'vitest'
import { isChargeFullyRefunded } from '@/lib/stripe'

describe('isChargeFullyRefunded', () => {
  it('returns true when charge.refunded is true', () => {
    expect(isChargeFullyRefunded({ refunded: true, amount_refunded: 0, amount: 1000 })).toBe(true)
  })

  it('returns true when amount_refunded >= amount', () => {
    expect(isChargeFullyRefunded({ refunded: false, amount_refunded: 1000, amount: 1000 })).toBe(true)
  })
})
