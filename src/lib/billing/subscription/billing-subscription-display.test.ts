import { describe, expect, it } from 'vitest'
import {
  getSubscriptionBadgeConfig,
  getSubscriptionCardAccent,
  shouldShowAccessEnds,
} from './billing-subscription-display'

describe('getSubscriptionBadgeConfig', () => {
  it('returns canceling badge when subscription is set to cancel', () => {
    expect(getSubscriptionBadgeConfig(true, 'active').label).toBe('Canceling')
  })

  it('returns payment issue badge for past_due', () => {
    expect(getSubscriptionBadgeConfig(false, 'past_due').label).toBe('Payment issue')
  })

  it('returns active badge for healthy subscriptions', () => {
    expect(getSubscriptionBadgeConfig(false, 'active').label).toBe('Active')
  })

  it('returns status unavailable when live Stripe is unreachable', () => {
    expect(getSubscriptionBadgeConfig(false, null, true).label).toBe('Status unavailable')
  })
})

describe('getSubscriptionCardAccent', () => {
  it('uses amber styling for past_due subscriptions', () => {
    const accent = getSubscriptionCardAccent(false, 'past_due')
    expect(accent.borderClassName).toContain('amber')
    expect(accent.icon).toBe('alert-triangle')
  })

  it('uses emerald styling for active subscriptions', () => {
    const accent = getSubscriptionCardAccent(false, 'active')
    expect(accent.iconClassName).toContain('emerald')
    expect(accent.icon).toBe('check-circle')
  })
})

describe('shouldShowAccessEnds', () => {
  it('returns true for canceling subscriptions', () => {
    expect(shouldShowAccessEnds(true, 'active')).toBe(true)
  })

  it('returns true for payment issue statuses', () => {
    expect(shouldShowAccessEnds(false, 'past_due')).toBe(true)
    expect(shouldShowAccessEnds(false, 'unpaid')).toBe(true)
  })

  it('returns false for active subscriptions', () => {
    expect(shouldShowAccessEnds(false, 'active')).toBe(false)
  })
})
