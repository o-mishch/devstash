import { describe, expect, it } from 'vitest'
import { fromStripeTs, stripeIntervalToEnum } from './stripe-utils'

describe('fromStripeTs', () => {
  it('converts Stripe unix seconds to a JS Date', () => {
    expect(fromStripeTs(1_700_000_000)).toEqual(new Date(1_700_000_000_000))
  })
})

describe('stripeIntervalToEnum', () => {
  it('maps month and year intervals', () => {
    expect(stripeIntervalToEnum('month')).toBe('month')
    expect(stripeIntervalToEnum('year')).toBe('year')
  })

  it('returns undefined for unknown intervals', () => {
    expect(stripeIntervalToEnum('week')).toBeUndefined()
    expect(stripeIntervalToEnum(undefined)).toBeUndefined()
  })
})
