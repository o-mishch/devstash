import { describe, expect, it, vi, beforeEach } from 'vitest'
import {
  loadBillingDisplayContext,
  resolveNeedsBillingRecovery,
  type BillingPageContext,
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

describe('toBillingContextResponse', () => {
  const page = {
    billing: {
      email: 'user@example.com',
      stripeCustomerId: 'cus_1',
      stripeSubscriptionId: 'sub_1',
      isPro: true,
      stripeSubscriptionStatus: 'active',
      stripeSubscriptionStart: new Date('2026-06-01T00:00:00.000Z'),
      stripeCurrentPeriodEnd: new Date('2026-07-01T00:00:00.000Z'),
      stripeSubscriptionInterval: 'month',
      stripeCancelAtPeriodEnd: false,
    },
    unavailable: false,
    isPro: true,
    needsBillingRecovery: false,
    checkoutDisabled: false,
    checkoutDisabledMessage: null,
    canManageBilling: true,
    // Server-only fields the wire shape must drop:
    checkoutConfigured: true,
    priceIdMonthly: 'price_m',
    priceIdYearly: 'price_y',
  }

  it('serializes Date fields to ISO strings and drops server-only config fields', async () => {
    const { toBillingContextResponse } = await import('./user-billing-state')
    const result = toBillingContextResponse(page as unknown as BillingPageContext, { itemsCount: 3, collectionsCount: 2 })

    expect(result.billing?.stripeSubscriptionStart).toBe('2026-06-01T00:00:00.000Z')
    expect(result.billing?.stripeCurrentPeriodEnd).toBe('2026-07-01T00:00:00.000Z')
    expect(result.usage).toEqual({ itemsCount: 3, collectionsCount: 2 })
    expect(result.isPro).toBe(true)
    expect('checkoutConfigured' in result).toBe(false)
    expect('priceIdMonthly' in result).toBe(false)
  })

  it('maps null Date fields to null and a null billing object to null', async () => {
    const { toBillingContextResponse } = await import('./user-billing-state')
    const nullDates = { ...page, billing: { ...page.billing, stripeSubscriptionStart: null, stripeCurrentPeriodEnd: null } }
    const result = toBillingContextResponse(nullDates as unknown as BillingPageContext, { itemsCount: 0, collectionsCount: 0 })
    expect(result.billing?.stripeSubscriptionStart).toBeNull()
    expect(result.billing?.stripeCurrentPeriodEnd).toBeNull()

    const noBilling = toBillingContextResponse({ ...page, billing: null } as never, { itemsCount: 0, collectionsCount: 0 })
    expect(noBilling.billing).toBeNull()
  })
})
