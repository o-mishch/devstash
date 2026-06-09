import { describe, expect, it } from 'vitest'
import {
  BILLING_UNAVAILABLE_MESSAGE,
  CHECKOUT_DISABLED_RECOVERY_MESSAGE,
  CHECKOUT_TOAST_MESSAGES,
  getBillingIssueMessage,
  getCheckoutNotificationMessage,
  getExistingSubscriptionMessage,
} from './billing-messages'

describe('billing message constants', () => {
  it('exports checkout disabled recovery copy', () => {
    expect(CHECKOUT_DISABLED_RECOVERY_MESSAGE).toMatch(/Manage Billing/i)
    expect(BILLING_UNAVAILABLE_MESSAGE).toMatch(/Unable to load billing/i)
  })
})

describe('getBillingIssueMessage', () => {
  it('returns past_due guidance when Pro access is still active', () => {
    expect(getBillingIssueMessage('past_due', true)).toMatch(/latest payment failed/i)
  })

  it('returns null for past_due when Pro is already revoked', () => {
    expect(getBillingIssueMessage('past_due', false)).toBeNull()
  })

  it('returns unpaid guidance', () => {
    expect(getBillingIssueMessage('unpaid', false)).toMatch(/unpaid invoice/i)
  })

  it('returns paused guidance', () => {
    expect(getBillingIssueMessage('paused', false)).toMatch(/subscription is paused/i)
  })

  it('returns null for active status', () => {
    expect(getBillingIssueMessage('active', true)).toBeNull()
  })
})

describe('getExistingSubscriptionMessage', () => {
  it('returns billing issue copy for past_due', () => {
    expect(getExistingSubscriptionMessage('past_due')).toMatch(/billing issue/i)
  })

  it('returns billing issue copy for unpaid and paused', () => {
    expect(getExistingSubscriptionMessage('unpaid')).toMatch(/billing issue/i)
    expect(getExistingSubscriptionMessage('paused')).toMatch(/billing issue/i)
  })

  it('returns generic copy for active subscription', () => {
    expect(getExistingSubscriptionMessage('active')).toMatch(/already have a subscription/i)
  })
})

describe('getCheckoutNotificationMessage', () => {
  it('returns checkout toast copy for standard outcomes', () => {
    expect(getCheckoutNotificationMessage({ type: 'success' })).toBe(CHECKOUT_TOAST_MESSAGES.success)
    expect(getCheckoutNotificationMessage({ type: 'syncing' })).toBe(CHECKOUT_TOAST_MESSAGES.syncing)
    expect(getCheckoutNotificationMessage({ type: 'canceled' })).toBe(CHECKOUT_TOAST_MESSAGES.canceled)
  })

  it('returns info message text for allowlisted notifications', () => {
    expect(getCheckoutNotificationMessage({
      type: 'info',
      messageKey: 'sync_pending',
    })).toMatch(/sync is still pending/i)
  })
})
