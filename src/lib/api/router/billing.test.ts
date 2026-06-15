import { vi, describe, it, expect, beforeEach } from 'vitest'
import { invoke, expectORPCError } from '@/test/orpc'

vi.mock('@/lib/session', () => ({ getCachedSession: vi.fn() }))
vi.mock('@/lib/stripe', () => ({
  createCheckoutSession: vi.fn(),
  createPortalSession: vi.fn(),
  ensureStripeCustomerUserId: vi.fn(),
  setSubscriptionCancelAtPeriodEnd: vi.fn(),
}))
const { mockGetUserStripeInfo } = vi.hoisted(() => ({ mockGetUserStripeInfo: vi.fn() }))
vi.mock('@/lib/billing/sync/user-billing-state', () => ({
  getCachedUserStripeInfo: mockGetUserStripeInfo,
  getCachedLiveSubscriptionState: vi.fn(),
}))
vi.mock('@/lib/billing/access/pro-access-resolution', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/billing/access/pro-access-resolution')>()
  return {
    ...actual,
    resolveProAccessBypassingCache: vi.fn(async () => false),
    getCachedVerifiedProAccess: vi.fn(async () => false),
    getFreshVerifiedProAccess: vi.fn(async () => true),
  }
})
vi.mock('@/lib/billing/subscription/stripe-subscription-persist', () => ({
  applyLiveSubscriptionAccessFromStripe: vi.fn(),
}))
vi.mock('@/lib/billing/checkout/stripe-checkout', () => ({
  validateCheckoutEligibility: vi.fn(async () => ({ status: 'ok' })),
  cancelIncompleteSubscriptionsForCustomer: vi.fn(),
}))
vi.mock('@/lib/billing/sync/passive-billing-sync', () => ({
  syncSubscriptionStateForUser: vi.fn(async () => ({ status: 'unchanged' })),
  reconcileOrphanStripeSubscriptionForUser: vi.fn(async () => false),
}))
vi.mock('@/lib/billing/config/billing-pricing', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/billing/config/billing-pricing')>()
  return { ...actual, isStripeCheckoutConfigured: vi.fn(() => true) }
})
vi.mock('@/lib/infra/cache', () => ({ invalidateBillingCache: vi.fn() }))
vi.mock('@/lib/infra/rate-limit', async () => {
  const actual = await vi.importActual<typeof import('@/lib/infra/rate-limit')>('@/lib/infra/rate-limit')
  return { ...actual, checkRateLimit: vi.fn() }
})
vi.mock('@/lib/utils/url', () => ({ getBaseUrl: vi.fn(() => 'https://devstash.io') }))

import { getCachedSession } from '@/lib/session'
import { checkRateLimit } from '@/lib/infra/rate-limit'
import {
  createCheckoutSession,
  createPortalSession,
  ensureStripeCustomerUserId,
  setSubscriptionCancelAtPeriodEnd,
} from '@/lib/stripe'
import { cancelIncompleteSubscriptionsForCustomer, validateCheckoutEligibility } from '@/lib/billing/checkout/stripe-checkout'
import { getCachedLiveSubscriptionState } from '@/lib/billing/sync/user-billing-state'
import { resolveProAccessBypassingCache } from '@/lib/billing/access/pro-access-resolution'
import { applyLiveSubscriptionAccessFromStripe } from '@/lib/billing/subscription/stripe-subscription-persist'
import { reconcileOrphanStripeSubscriptionForUser, syncSubscriptionStateForUser } from '@/lib/billing/sync/passive-billing-sync'
import { isStripeCheckoutConfigured } from '@/lib/billing/config/billing-pricing'
import { billingRouter } from './billing'

const mockSession = getCachedSession as ReturnType<typeof vi.fn>
const mockCheckRateLimit = checkRateLimit as ReturnType<typeof vi.fn>
const mockCancelIncompleteSubscriptionsForCustomer = cancelIncompleteSubscriptionsForCustomer as ReturnType<typeof vi.fn>
const mockEnsureStripeCustomerUserId = ensureStripeCustomerUserId as ReturnType<typeof vi.fn>
const mockCreateCheckoutSession = createCheckoutSession as ReturnType<typeof vi.fn>
const mockCreatePortalSession = createPortalSession as ReturnType<typeof vi.fn>
const mockSetCancelAtPeriodEnd = setSubscriptionCancelAtPeriodEnd as ReturnType<typeof vi.fn>
const mockGetCachedLiveSubscriptionState = getCachedLiveSubscriptionState as ReturnType<typeof vi.fn>
const mockResolveProAccessBypassingCache = resolveProAccessBypassingCache as ReturnType<typeof vi.fn>
const mockApplyLiveSubscriptionAccessFromStripe = applyLiveSubscriptionAccessFromStripe as ReturnType<typeof vi.fn>
const mockValidateCheckoutEligibility = validateCheckoutEligibility as ReturnType<typeof vi.fn>
const mockReconcileOrphanStripeSubscriptionForUser = reconcileOrphanStripeSubscriptionForUser as ReturnType<typeof vi.fn>
const mockSyncSubscriptionStateForUser = syncSubscriptionStateForUser as ReturnType<typeof vi.fn>
const mockIsStripeCheckoutConfigured = isStripeCheckoutConfigured as ReturnType<typeof vi.fn>

beforeEach(() => {
  vi.clearAllMocks()
  process.env.STRIPE_PRICE_ID_MONTHLY = 'price_123'
  process.env.STRIPE_PRICE_ID_YEARLY = 'price_yearly'
  mockSession.mockResolvedValue({ user: { id: 'user-1', email: 'a@b.com' } })
  mockCheckRateLimit.mockResolvedValue({ success: true, retryAfter: 0 })
  mockIsStripeCheckoutConfigured.mockReturnValue(true)
  mockResolveProAccessBypassingCache.mockResolvedValue(false)
  mockValidateCheckoutEligibility.mockResolvedValue({ status: 'ok' })
  mockReconcileOrphanStripeSubscriptionForUser.mockResolvedValue(false)
  mockCancelIncompleteSubscriptionsForCustomer.mockResolvedValue(undefined)
  mockEnsureStripeCustomerUserId.mockResolvedValue(true)
  mockGetCachedLiveSubscriptionState.mockResolvedValue({
    exists: true,
    cancelAtPeriodEnd: false,
    currentPeriodEnd: new Date('2026-07-01T00:00:00.000Z'),
    interval: 'month',
    status: 'active',
  })
  mockApplyLiveSubscriptionAccessFromStripe.mockResolvedValue('updated')
  mockSyncSubscriptionStateForUser.mockResolvedValue({ status: 'unchanged' })
})

describe('billing.createCheckout', () => {
  it('throws UNAUTHORIZED when not signed in', async () => {
    mockSession.mockResolvedValue(null)
    await expectORPCError(invoke(billingRouter.createCheckout, { priceId: 'price_123' }), 'UNAUTHORIZED')
  })

  it('rejects a disallowed priceId before eligibility', async () => {
    await expectORPCError(invoke(billingRouter.createCheckout, { priceId: 'price_not_allowed' }), 'BAD_REQUEST')
    expect(mockCreateCheckoutSession).not.toHaveBeenCalled()
    expect(mockValidateCheckoutEligibility).not.toHaveBeenCalled()
  })

  it('throws INTERNAL_SERVER_ERROR when Stripe price IDs are not configured', async () => {
    mockIsStripeCheckoutConfigured.mockReturnValue(false)
    await expectORPCError(invoke(billingRouter.createCheckout, { priceId: 'price_123' }), 'INTERNAL_SERVER_ERROR')
    expect(mockCreateCheckoutSession).not.toHaveBeenCalled()
  })

  it('throws INTERNAL_SERVER_ERROR when Stripe returns no session URL', async () => {
    mockCreateCheckoutSession.mockResolvedValue({ url: null, id: 'cs_test' })
    await expectORPCError(invoke(billingRouter.createCheckout, { priceId: 'price_123' }), 'INTERNAL_SERVER_ERROR')
  })

  it('throws INTERNAL_SERVER_ERROR when Stripe API throws', async () => {
    mockCreateCheckoutSession.mockRejectedValue(new Error('Stripe network error'))
    await expectORPCError(invoke(billingRouter.createCheckout, { priceId: 'price_123' }), 'INTERNAL_SERVER_ERROR')
  })

  it('throws CONFLICT when the customer already has a subscription', async () => {
    mockValidateCheckoutEligibility.mockResolvedValue({ status: 'existing_subscription', subscriptionId: 'sub_abc', subscriptionStatus: 'active' })
    await expectORPCError(invoke(billingRouter.createCheckout, { priceId: 'price_123' }), 'CONFLICT')
    expect(mockReconcileOrphanStripeSubscriptionForUser).toHaveBeenCalledWith('user-1', undefined)
    expect(mockCreateCheckoutSession).not.toHaveBeenCalled()
  })

  it('returns the checkout-return URL when an orphan subscription is linked before checkout', async () => {
    const blockingSubscription = { id: 'sub_abc', status: 'active' }
    mockValidateCheckoutEligibility.mockResolvedValue({
      status: 'existing_subscription',
      customerId: 'cus_abc',
      subscriptionId: 'sub_abc',
      subscriptionStatus: 'active',
      blockingSubscription,
    })
    mockReconcileOrphanStripeSubscriptionForUser.mockResolvedValue(true)
    const result = await invoke(billingRouter.createCheckout, { priceId: 'price_123' })
    expect(result).toEqual({ url: 'https://devstash.io/api/billing/checkout-return' })
    expect(mockReconcileOrphanStripeSubscriptionForUser).toHaveBeenCalledWith('user-1', { customerId: 'cus_abc', blockingSubscription })
  })

  it('throws CONFLICT when the user already has active Pro access', async () => {
    mockResolveProAccessBypassingCache.mockResolvedValue(true)
    await expectORPCError(invoke(billingRouter.createCheckout, { priceId: 'price_123' }), 'CONFLICT')
    expect(mockValidateCheckoutEligibility).not.toHaveBeenCalled()
    expect(mockCreateCheckoutSession).not.toHaveBeenCalled()
  })

  it('throws TOO_MANY_REQUESTS when checkout is rate limited', async () => {
    mockCheckRateLimit.mockResolvedValue({ success: false, retryAfter: 60 })
    await expectORPCError(invoke(billingRouter.createCheckout, { priceId: 'price_123' }), 'TOO_MANY_REQUESTS')
    expect(mockCreateCheckoutSession).not.toHaveBeenCalled()
  })

  it('creates the session with correct params and returns the URL on success', async () => {
    mockGetUserStripeInfo.mockResolvedValue({ stripeCustomerId: 'cus_abc' })
    mockCreateCheckoutSession.mockResolvedValue({ url: 'https://checkout.stripe.com/pay/abc', id: 'cs_abc' })
    const result = await invoke(billingRouter.createCheckout, { priceId: 'price_123' })
    expect(mockEnsureStripeCustomerUserId).toHaveBeenCalledWith('cus_abc', 'user-1')
    expect(mockCancelIncompleteSubscriptionsForCustomer).toHaveBeenCalledWith('cus_abc')
    expect(mockCreateCheckoutSession).toHaveBeenCalledWith(
      expect.objectContaining({ priceId: 'price_123', userId: 'user-1', userEmail: 'a@b.com', customerId: 'cus_abc' }),
    )
    expect(result).toEqual({ url: 'https://checkout.stripe.com/pay/abc' })
  })

  it('creates the session without a customerId when the user has no Stripe customer yet', async () => {
    mockGetUserStripeInfo.mockResolvedValue({ stripeCustomerId: null })
    mockCreateCheckoutSession.mockResolvedValue({ url: 'https://checkout.stripe.com/pay/abc', id: 'cs_abc' })
    await invoke(billingRouter.createCheckout, { priceId: 'price_123' })
    expect(mockCreateCheckoutSession).toHaveBeenCalledWith(expect.objectContaining({ customerId: undefined }))
    expect(mockCancelIncompleteSubscriptionsForCustomer).not.toHaveBeenCalled()
  })

  it('throws INTERNAL_SERVER_ERROR when the eligibility check fails', async () => {
    mockValidateCheckoutEligibility.mockResolvedValue({ status: 'error' })
    await expectORPCError(invoke(billingRouter.createCheckout, { priceId: 'price_123' }), 'INTERNAL_SERVER_ERROR')
    expect(mockCreateCheckoutSession).not.toHaveBeenCalled()
  })

  it('throws CONFLICT when the Stripe customer is linked to another user', async () => {
    mockValidateCheckoutEligibility.mockResolvedValue({ status: 'ok', customerId: 'cus_other' })
    mockEnsureStripeCustomerUserId.mockResolvedValue(false)
    await expectORPCError(invoke(billingRouter.createCheckout, { priceId: 'price_123' }), 'CONFLICT')
    expect(mockCreateCheckoutSession).not.toHaveBeenCalled()
  })
})

describe('billing.createPortal', () => {
  it('throws UNAUTHORIZED when not signed in', async () => {
    mockSession.mockResolvedValue(null)
    await expectORPCError(invoke(billingRouter.createPortal, undefined), 'UNAUTHORIZED')
  })

  it('throws BAD_REQUEST when the user has no stripeCustomerId', async () => {
    mockGetUserStripeInfo.mockResolvedValue({ stripeCustomerId: null })
    await expectORPCError(invoke(billingRouter.createPortal, undefined), 'BAD_REQUEST')
  })

  it('throws TOO_MANY_REQUESTS when rate limited', async () => {
    mockCheckRateLimit.mockResolvedValue({ success: false, retryAfter: 60 })
    await expectORPCError(invoke(billingRouter.createPortal, undefined), 'TOO_MANY_REQUESTS')
    expect(mockCreatePortalSession).not.toHaveBeenCalled()
  })

  it('throws INTERNAL_SERVER_ERROR when the portal session returns no URL', async () => {
    mockGetUserStripeInfo.mockResolvedValue({ stripeCustomerId: 'cus_abc' })
    mockCreatePortalSession.mockResolvedValue({ url: null })
    await expectORPCError(invoke(billingRouter.createPortal, undefined), 'INTERNAL_SERVER_ERROR')
  })

  it('creates the portal session with the correct customer ID and returns the URL on success', async () => {
    mockGetUserStripeInfo.mockResolvedValue({ stripeCustomerId: 'cus_abc' })
    mockCreatePortalSession.mockResolvedValue({ url: 'https://billing.stripe.com/session/abc' })
    const result = await invoke(billingRouter.createPortal, undefined)
    expect(mockCreatePortalSession).toHaveBeenCalledWith('cus_abc', expect.stringContaining('/settings'))
    expect(result).toEqual({ url: 'https://billing.stripe.com/session/abc' })
  })
})

describe('billing.cancelSubscription', () => {
  beforeEach(() => mockSetCancelAtPeriodEnd.mockResolvedValue(undefined))

  it('throws UNAUTHORIZED when not signed in', async () => {
    mockSession.mockResolvedValue(null)
    await expectORPCError(invoke(billingRouter.cancelSubscription, undefined), 'UNAUTHORIZED')
  })

  it('throws BAD_REQUEST when the user has no subscription', async () => {
    mockGetUserStripeInfo.mockResolvedValue({ stripeSubscriptionId: null })
    await expectORPCError(invoke(billingRouter.cancelSubscription, undefined), 'BAD_REQUEST')
  })

  it('throws TOO_MANY_REQUESTS when rate limited', async () => {
    mockGetUserStripeInfo.mockResolvedValue({ stripeSubscriptionId: 'sub_abc', stripeCustomerId: 'cus_abc' })
    mockCheckRateLimit.mockResolvedValue({ success: false, retryAfter: 60 })
    await expectORPCError(invoke(billingRouter.cancelSubscription, undefined), 'TOO_MANY_REQUESTS')
    expect(mockSetCancelAtPeriodEnd).not.toHaveBeenCalled()
  })

  it('throws INTERNAL_SERVER_ERROR and attempts recovery when a Stripe call throws after cancel', async () => {
    mockGetUserStripeInfo.mockResolvedValue({ stripeSubscriptionId: 'sub_abc', stripeCustomerId: 'cus_abc' })
    mockGetCachedLiveSubscriptionState.mockRejectedValue(new Error('Stripe error'))
    await expectORPCError(invoke(billingRouter.cancelSubscription, undefined), 'INTERNAL_SERVER_ERROR')
    expect(mockSetCancelAtPeriodEnd).toHaveBeenCalledWith('sub_abc', true)
    expect(mockSyncSubscriptionStateForUser).toHaveBeenCalledWith('user-1')
  })

  it('throws INTERNAL_SERVER_ERROR when live Stripe state cannot be fetched after cancel', async () => {
    mockGetUserStripeInfo.mockResolvedValue({ stripeSubscriptionId: 'sub_abc', stripeCustomerId: 'cus_abc' })
    mockGetCachedLiveSubscriptionState.mockResolvedValue(null)
    await expectORPCError(invoke(billingRouter.cancelSubscription, undefined), 'INTERNAL_SERVER_ERROR')
    expect(mockSetCancelAtPeriodEnd).toHaveBeenCalledWith('sub_abc', true)
  })

  it('attempts billing sync recovery when the DB persist fails after cancel', async () => {
    mockGetUserStripeInfo.mockResolvedValue({ stripeSubscriptionId: 'sub_abc', stripeCustomerId: 'cus_abc' })
    mockApplyLiveSubscriptionAccessFromStripe.mockRejectedValue(new Error('DB write failed'))
    await expectORPCError(invoke(billingRouter.cancelSubscription, undefined), 'INTERNAL_SERVER_ERROR')
    expect(mockSyncSubscriptionStateForUser).toHaveBeenCalledWith('user-1')
  })

  it('cancels the subscription and syncs live Stripe state to the DB on success', async () => {
    mockGetUserStripeInfo.mockResolvedValue({ stripeSubscriptionId: 'sub_abc', stripeCustomerId: 'cus_abc' })
    const liveState = {
      exists: true,
      cancelAtPeriodEnd: true,
      currentPeriodEnd: new Date('2026-07-01T00:00:00.000Z'),
      interval: 'month' as const,
      status: 'active' as const,
    }
    mockGetCachedLiveSubscriptionState.mockResolvedValue(liveState)
    await invoke(billingRouter.cancelSubscription, undefined)
    expect(mockSetCancelAtPeriodEnd).toHaveBeenCalledWith('sub_abc', true)
    expect(mockApplyLiveSubscriptionAccessFromStripe).toHaveBeenCalledWith('sub_abc', liveState, { userId: 'user-1', customerId: 'cus_abc' })
  })
})

describe('billing.reactivateSubscription', () => {
  beforeEach(() => mockSetCancelAtPeriodEnd.mockResolvedValue(undefined))

  it('throws UNAUTHORIZED when not signed in', async () => {
    mockSession.mockResolvedValue(null)
    await expectORPCError(invoke(billingRouter.reactivateSubscription, undefined), 'UNAUTHORIZED')
  })

  it('throws BAD_REQUEST when the user has no subscription', async () => {
    mockGetUserStripeInfo.mockResolvedValue({ stripeSubscriptionId: null })
    await expectORPCError(invoke(billingRouter.reactivateSubscription, undefined), 'BAD_REQUEST')
  })

  it('reactivates the subscription and syncs live Stripe state to the DB on success', async () => {
    mockGetUserStripeInfo.mockResolvedValue({ stripeSubscriptionId: 'sub_abc', stripeCustomerId: 'cus_abc' })
    await invoke(billingRouter.reactivateSubscription, undefined)
    expect(mockSetCancelAtPeriodEnd).toHaveBeenCalledWith('sub_abc', false)
    expect(mockApplyLiveSubscriptionAccessFromStripe).toHaveBeenCalledWith(
      'sub_abc',
      expect.objectContaining({ cancelAtPeriodEnd: false }),
      { userId: 'user-1', customerId: 'cus_abc' },
    )
  })
})
