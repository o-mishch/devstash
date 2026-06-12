import { describe, expect, it, vi, beforeEach } from 'vitest'
import {
  loadBillingDisplayContext,
  resolveNeedsBillingRecovery,
} from './user-billing-state'

const { mockGetUserStripeInfo } = vi.hoisted(() => ({
  mockGetUserStripeInfo: vi.fn(),
}))

vi.mock('@/lib/db/stripe', () => ({
  getUserStripeInfo: mockGetUserStripeInfo,
}))

vi.mock('@/lib/billing/stripe-api', () => ({
  fetchLiveSubscriptionState: vi.fn(),
}))

const baseStripeInfo = {
  email: 'user@example.com',
  stripeCustomerId: 'cus_1',
  stripeSubscriptionId: 'sub_1',
  stripeSubscriptionStatus: 'active',
  isPro: false,
  stripeSubscriptionStart: null,
  stripeCurrentPeriodEnd: new Date('2026-07-01T00:00:00.000Z'),
  stripeSubscriptionInterval: 'month' as const,
  stripeCancelAtPeriodEnd: false,
  stripeLastSyncAt: new Date('2026-06-01T00:00:00.000Z'),
  proExpiredAt: null,
}

describe('loadBillingDisplayContext', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockGetUserStripeInfo.mockResolvedValue(baseStripeInfo)
  })

  it('returns billing fields from the database', async () => {
    mockGetUserStripeInfo.mockResolvedValue({ ...baseStripeInfo, isPro: true })

    const result = await loadBillingDisplayContext('user_1', false)

    expect(result.unavailable).toBe(false)
    expect(result.isPro).toBe(true)
    expect(result.billing?.stripeCurrentPeriodEnd?.toISOString()).toBe('2026-07-01T00:00:00.000Z')
    expect(result.billing?.stripeSubscriptionStatus).toBe('active')
  })

  it('reads fresh DB row after a billing write', async () => {
    mockGetUserStripeInfo.mockResolvedValue({
      ...baseStripeInfo,
      stripeSubscriptionId: 'sub_linked',
      isPro: true,
    })

    const result = await loadBillingDisplayContext('user_1', false, { freshBillingContext: true })

    expect(result.billing?.stripeSubscriptionId).toBe('sub_linked')
    expect(result.isPro).toBe(true)
  })

  it('flags billing portal recovery for unpaid subscriptions with a linked customer', async () => {
    mockGetUserStripeInfo.mockResolvedValue({
      ...baseStripeInfo,
      stripeSubscriptionStatus: 'unpaid',
      isPro: false,
    })

    const result = await loadBillingDisplayContext('user_1', false)

    expect(result.isPro).toBe(false)
    expect(result.needsBillingRecovery).toBe(true)
  })

  it('does not flag portal recovery when status is null', async () => {
    mockGetUserStripeInfo.mockResolvedValue({
      ...baseStripeInfo,
      stripeSubscriptionStatus: null,
      isPro: false,
    })

    const result = await loadBillingDisplayContext('user_1', false)

    expect(result.needsBillingRecovery).toBe(false)
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
      stripeSubscriptionStatus: 'past_due',
    } as never)).toBe(false)
  })

  it('returns true for non-Pro users with a linked customer and recovery status', () => {
    expect(resolveNeedsBillingRecovery(false, {
      stripeCustomerId: 'cus_1',
      stripeSubscriptionStatus: 'unpaid',
    } as never)).toBe(true)
  })

  it('returns false when status is null', () => {
    expect(resolveNeedsBillingRecovery(false, {
      stripeCustomerId: 'cus_1',
      stripeSubscriptionId: 'sub_1',
      stripeSubscriptionStatus: null,
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
