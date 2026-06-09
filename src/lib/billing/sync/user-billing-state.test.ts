import { describe, expect, it, vi, beforeEach } from 'vitest'
import {
  loadBillingDisplayContext,
  resolveNeedsBillingRecovery,
} from './user-billing-state'

const { mockGetUserStripeInfo, mockResolveProAccessForBillingContext, mockGetCachedLiveSubscriptionState } = vi.hoisted(() => ({
  mockGetUserStripeInfo: vi.fn(),
  mockResolveProAccessForBillingContext: vi.fn(),
  mockGetCachedLiveSubscriptionState: vi.fn(),
}))

vi.mock('@/lib/db/stripe', () => ({
  getUserStripeInfo: mockGetUserStripeInfo,
}))

vi.mock('@/lib/billing/stripe-api', () => ({
  fetchLiveSubscriptionState: mockGetCachedLiveSubscriptionState,
}))

vi.mock('@/lib/billing/access/pro-access-resolution', () => ({
  resolveProAccessForBillingContext: mockResolveProAccessForBillingContext,
}))

const baseStripeInfo = {
  email: 'user@example.com',
  stripeCustomerId: 'cus_1',
  stripeSubscriptionId: 'sub_1',
  isPro: false,
  subscriptionStart: null,
  currentPeriodEnd: new Date('2026-07-01T00:00:00.000Z'),
  subscriptionInterval: 'month' as const,
  cancelAtPeriodEnd: false,
  lastStripeSyncAt: new Date('2026-06-01T00:00:00.000Z'),
  proExpiredAt: null,
}

describe('loadBillingDisplayContext', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockGetUserStripeInfo.mockResolvedValue(baseStripeInfo)
    mockResolveProAccessForBillingContext.mockResolvedValue(false)
    mockGetCachedLiveSubscriptionState.mockResolvedValue({ status: 'active' })
  })

  it('returns billing fields from the database with live Pro and status checks', async () => {
    mockResolveProAccessForBillingContext.mockResolvedValue(true)

    const result = await loadBillingDisplayContext('user_1', false)

    expect(result.unavailable).toBe(false)
    expect(result.isPro).toBe(true)
    expect(result.billing?.currentPeriodEnd?.toISOString()).toBe('2026-07-01T00:00:00.000Z')
    expect(result.billing?.stripeStatus).toBe('active')
  })

  it('reuses cached Pro access when the app layout already refreshed entitlements', async () => {
    mockResolveProAccessForBillingContext.mockResolvedValue(true)

    const result = await loadBillingDisplayContext('user_1', false, { freshBillingContext: true })

    expect(mockResolveProAccessForBillingContext).toHaveBeenCalledWith('user_1', { freshBillingContext: true })
    expect(result.isPro).toBe(true)
  })

  it('reads fresh Stripe row and Pro access after a billing write', async () => {
    mockGetUserStripeInfo.mockResolvedValue({
      ...baseStripeInfo,
      stripeSubscriptionId: 'sub_linked',
    })
    mockResolveProAccessForBillingContext.mockResolvedValue(true)

    const result = await loadBillingDisplayContext('user_1', false, { freshBillingContext: true })

    expect(mockResolveProAccessForBillingContext).toHaveBeenCalledWith('user_1', { freshBillingContext: true })
    expect(result.billing?.stripeSubscriptionId).toBe('sub_linked')
    expect(result.isPro).toBe(true)
  })

  it('flags billing portal recovery for unpaid subscriptions with a linked customer', async () => {
    mockGetCachedLiveSubscriptionState.mockResolvedValue({ status: 'unpaid' })

    const result = await loadBillingDisplayContext('user_1', false)

    expect(result.isPro).toBe(false)
    expect(result.needsBillingRecovery).toBe(true)
  })

  it('does not flag portal recovery when live Stripe is unavailable but subscription is linked', async () => {
    mockGetCachedLiveSubscriptionState.mockResolvedValue(null)

    const result = await loadBillingDisplayContext('user_1', false)

    expect(result.needsBillingRecovery).toBe(false)
    expect(result.billing?.liveStripeUnavailable).toBe(true)
  })

  it('preserves session fallback Pro status when billing lookup fails', async () => {
    mockGetUserStripeInfo.mockRejectedValue(new Error('db down'))

    const result = await loadBillingDisplayContext('user_1', true)

    expect(result).toEqual({
      billing: null,
      unavailable: true,
      isPro: true,
      needsBillingRecovery: false,
    })
  })
})

describe('resolveNeedsBillingRecovery', () => {
  it('returns false for Pro users even when Stripe status needs portal recovery', () => {
    expect(resolveNeedsBillingRecovery(true, {
      stripeCustomerId: 'cus_1',
      stripeStatus: 'past_due',
    } as never)).toBe(false)
  })

  it('returns true for non-Pro users with a linked customer and recovery status', () => {
    expect(resolveNeedsBillingRecovery(false, {
      stripeCustomerId: 'cus_1',
      stripeStatus: 'unpaid',
      liveStripeUnavailable: false,
    } as never)).toBe(true)
  })

  it('returns false when live Stripe is unavailable but status is not a recovery state', () => {
    expect(resolveNeedsBillingRecovery(false, {
      stripeCustomerId: 'cus_1',
      stripeSubscriptionId: 'sub_1',
      stripeStatus: null,
      liveStripeUnavailable: true,
    } as never)).toBe(false)
  })
})

describe('resolveCheckoutUiState', () => {
  it('disables checkout when billing is unavailable', async () => {
    const { resolveCheckoutUiState } = await import('./user-billing-state')
    const { BILLING_UNAVAILABLE_MESSAGE } = await import('../messages/billing-messages')
    expect(resolveCheckoutUiState({
      needsBillingRecovery: false,
      billingUnavailable: true,
      checkoutConfigured: true,
    })).toEqual({
      checkoutDisabled: true,
      checkoutDisabledMessage: BILLING_UNAVAILABLE_MESSAGE,
    })
  })

  it('disables checkout when Stripe prices are not configured', async () => {
    const { resolveCheckoutUiState } = await import('./user-billing-state')
    const { CHECKOUT_NOT_CONFIGURED_MESSAGE } = await import('../messages/billing-messages.client')
    expect(resolveCheckoutUiState({
      needsBillingRecovery: false,
      billingUnavailable: false,
      checkoutConfigured: false,
    })).toEqual({
      checkoutDisabled: true,
      checkoutDisabledMessage: CHECKOUT_NOT_CONFIGURED_MESSAGE,
    })
  })

  it('disables checkout when live Stripe is unavailable for a linked subscription', async () => {
    const { resolveCheckoutUiState } = await import('./user-billing-state')
    const { BILLING_UNAVAILABLE_MESSAGE } = await import('../messages/billing-messages')
    expect(resolveCheckoutUiState({
      needsBillingRecovery: false,
      billingUnavailable: false,
      liveStripeUnavailable: true,
      hasLinkedSubscription: true,
      checkoutConfigured: true,
    })).toEqual({
      checkoutDisabled: true,
      checkoutDisabledMessage: BILLING_UNAVAILABLE_MESSAGE,
    })
  })

  it('enables checkout when billing is healthy', async () => {
    const { resolveCheckoutUiState } = await import('./user-billing-state')
    expect(resolveCheckoutUiState({
      needsBillingRecovery: false,
      billingUnavailable: false,
      checkoutConfigured: true,
    })).toEqual({
      checkoutDisabled: false,
      checkoutDisabledMessage: null,
    })
  })
})
