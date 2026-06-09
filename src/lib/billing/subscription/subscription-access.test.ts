import { describe, expect, it } from 'vitest'
import {
  checkoutSubscriptionBlocksNewCheckout,
  isSubscriptionCanceling,
  shouldDeferPeriodEndToInvoicePaid,
  shouldGrantCheckoutProAccess,
  subscriptionHasProAccess,
  subscriptionShouldClearLocalLink,
} from './subscription-access'

describe('checkoutSubscriptionBlocksNewCheckout', () => {
  it('blocks active and recoverable billing states', () => {
    expect(checkoutSubscriptionBlocksNewCheckout('active')).toBe(true)
    expect(checkoutSubscriptionBlocksNewCheckout('trialing')).toBe(true)
    expect(checkoutSubscriptionBlocksNewCheckout('past_due')).toBe(true)
    expect(checkoutSubscriptionBlocksNewCheckout('unpaid')).toBe(true)
    expect(checkoutSubscriptionBlocksNewCheckout('paused')).toBe(true)
  })

  it('does not block abandoned or ended subscriptions', () => {
    expect(checkoutSubscriptionBlocksNewCheckout('incomplete')).toBe(false)
    expect(checkoutSubscriptionBlocksNewCheckout('incomplete_expired')).toBe(false)
    expect(checkoutSubscriptionBlocksNewCheckout('canceled')).toBe(false)
  })
})

describe('subscriptionShouldClearLocalLink', () => {
  it('clears terminal subscriptions but retains incomplete checkouts awaiting async payment', () => {
    expect(subscriptionShouldClearLocalLink('incomplete')).toBe(false)
    expect(subscriptionShouldClearLocalLink('incomplete_expired')).toBe(true)
    expect(subscriptionShouldClearLocalLink('canceled')).toBe(true)
    expect(subscriptionShouldClearLocalLink('unpaid')).toBe(false)
    expect(subscriptionShouldClearLocalLink('active')).toBe(false)
  })
})

describe('subscriptionHasProAccess', () => {
  it('grants access during active billing and past_due grace', () => {
    expect(subscriptionHasProAccess('active')).toBe(true)
    expect(subscriptionHasProAccess('trialing')).toBe(true)
    expect(subscriptionHasProAccess('past_due')).toBe(true)
    expect(subscriptionHasProAccess('unpaid')).toBe(false)
  })
})

describe('shouldGrantCheckoutProAccess', () => {
  it('grants Pro for settled checkout sessions with entitled subscription status', () => {
    expect(shouldGrantCheckoutProAccess('paid', 'active')).toBe(true)
    expect(shouldGrantCheckoutProAccess('no_payment_required', 'active')).toBe(true)
    expect(shouldGrantCheckoutProAccess('unpaid', 'trialing')).toBe(true)
  })

  it('withholds Pro for unpaid checkout and non-entitled subscription states', () => {
    expect(shouldGrantCheckoutProAccess('unpaid', 'incomplete')).toBe(false)
    expect(shouldGrantCheckoutProAccess('no_payment_required', 'unpaid')).toBe(false)
    expect(shouldGrantCheckoutProAccess('paid', 'unpaid')).toBe(false)
  })

  it('grants Pro when async payment succeeds even if payment status is still unpaid', () => {
    expect(shouldGrantCheckoutProAccess('unpaid', 'incomplete', true)).toBe(true)
  })
})

describe('shouldDeferPeriodEndToInvoicePaid', () => {
  it('defers period writes for entitled subscriptions that are not canceling', () => {
    expect(shouldDeferPeriodEndToInvoicePaid('active', false)).toBe(true)
    expect(shouldDeferPeriodEndToInvoicePaid('trialing', false)).toBe(true)
    expect(shouldDeferPeriodEndToInvoicePaid('past_due', false)).toBe(true)
  })

  it('does not defer when access is not entitled or cancellation is scheduled', () => {
    expect(shouldDeferPeriodEndToInvoicePaid('paused', false)).toBe(false)
    expect(shouldDeferPeriodEndToInvoicePaid('active', true)).toBe(false)
  })
})

describe('isSubscriptionCanceling', () => {
  it('detects cancel-at-period-end and scheduled cancellations', () => {
    expect(isSubscriptionCanceling({
      cancel_at_period_end: true,
      cancel_at: null,
    })).toBe(true)
    expect(isSubscriptionCanceling({
      cancel_at_period_end: false,
      cancel_at: 1_700_000_000,
    })).toBe(true)
    expect(isSubscriptionCanceling({
      cancel_at_period_end: false,
      cancel_at: null,
    })).toBe(false)
  })

  it('does not treat completed cancellation as scheduled canceling', () => {
    expect(isSubscriptionCanceling({
      cancel_at_period_end: false,
      cancel_at: null,
    })).toBe(false)
  })
})
