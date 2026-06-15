import { vi, describe, it, expect, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('@/auth', () => ({ auth: vi.fn() }))
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
const { mockRateLimitRoute } = vi.hoisted(() => ({ mockRateLimitRoute: vi.fn() }))
vi.mock('@/lib/infra/rate-limit', async () => {
  const actual = await vi.importActual<typeof import('@/lib/infra/rate-limit')>('@/lib/infra/rate-limit')
  return { ...actual, rateLimitRoute: mockRateLimitRoute }
})
vi.mock('@/lib/utils/url', () => ({ getBaseUrl: vi.fn(() => 'https://devstash.io') }))
vi.mock('@/lib/infra/pino', () => ({
  logger: { child: () => ({ info: vi.fn(), error: vi.fn(), warn: vi.fn() }) },
}))

import { auth } from '@/auth'
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

import { POST as CHECKOUT } from './checkout/route'
import { POST as PORTAL } from './portal/route'
import { POST as CANCEL } from './cancel/route'
import { POST as REACTIVATE } from './reactivate/route'

const mockAuth = auth as ReturnType<typeof vi.fn>
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

type RouteHandler = (request: NextRequest, context: { params: Promise<Record<string, string>> }) => Promise<Response>

async function call(handler: RouteHandler, body?: unknown) {
  const req = new NextRequest('http://localhost/api/billing', {
    method: 'POST',
    ...(body !== undefined ? { body: JSON.stringify(body), headers: { 'content-type': 'application/json' } } : {}),
  })
  const res = await handler(req, { params: Promise.resolve({}) })
  return res.json()
}

const RATE_LIMITED = { body: { status: 'too_many_requests', data: null, message: 'Too many requests.' }, headers: {} }

beforeEach(() => {
  vi.clearAllMocks()
  process.env.STRIPE_PRICE_ID_MONTHLY = 'price_123'
  process.env.STRIPE_PRICE_ID_YEARLY = 'price_yearly'
  mockAuth.mockResolvedValue({ user: { id: 'user-1', email: 'a@b.com' } })
  mockRateLimitRoute.mockResolvedValue(null)
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

describe('POST /api/billing/checkout', () => {
  it('returns unauthorized when not signed in', async () => {
    mockAuth.mockResolvedValue(null)
    expect((await call(CHECKOUT, { priceId: 'price_123' })).status).toBe('unauthorized')
  })

  it('returns validation_error when priceId is missing', async () => {
    const result = await call(CHECKOUT, {})
    expect(result.status).toBe('validation_error')
    expect(mockCreateCheckoutSession).not.toHaveBeenCalled()
  })

  it('returns validation_error when priceId is not allowed', async () => {
    const result = await call(CHECKOUT, { priceId: 'price_not_allowed' })
    expect(result.status).toBe('validation_error')
    expect(mockCreateCheckoutSession).not.toHaveBeenCalled()
    expect(mockValidateCheckoutEligibility).not.toHaveBeenCalled()
  })

  it('returns internal_error when Stripe price IDs are not configured', async () => {
    mockIsStripeCheckoutConfigured.mockReturnValue(false)
    const result = await call(CHECKOUT, { priceId: 'price_123' })
    expect(result.status).toBe('internal_error')
    expect(result.message).toContain('Billing is temporarily unavailable')
    expect(mockCreateCheckoutSession).not.toHaveBeenCalled()
  })

  it('returns internal_error when Stripe returns no session URL', async () => {
    mockCreateCheckoutSession.mockResolvedValue({ url: null, id: 'cs_test' })
    expect((await call(CHECKOUT, { priceId: 'price_123' })).status).toBe('internal_error')
  })

  it('returns internal_error when Stripe API throws', async () => {
    mockCreateCheckoutSession.mockRejectedValue(new Error('Stripe network error'))
    const result = await call(CHECKOUT, { priceId: 'price_123' })
    expect(result.status).toBe('internal_error')
    expect(result.message).toContain('Unable to start checkout')
  })

  it('returns conflict when the customer already has a subscription', async () => {
    mockValidateCheckoutEligibility.mockResolvedValue({ status: 'existing_subscription', subscriptionId: 'sub_abc', subscriptionStatus: 'active' })
    const result = await call(CHECKOUT, { priceId: 'price_123' })
    expect(result.status).toBe('conflict')
    expect(result.message).toContain('Manage it from Billing settings')
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
    const result = await call(CHECKOUT, { priceId: 'price_123' })
    expect(result.status).toBe('ok')
    expect(result.data.url).toBe('https://devstash.io/api/billing/checkout-return')
    expect(mockReconcileOrphanStripeSubscriptionForUser).toHaveBeenCalledWith('user-1', { customerId: 'cus_abc', blockingSubscription })
  })

  it('returns a billing recovery message when the subscription is past due', async () => {
    mockValidateCheckoutEligibility.mockResolvedValue({ status: 'existing_subscription', subscriptionId: 'sub_abc', subscriptionStatus: 'past_due' })
    const result = await call(CHECKOUT, { priceId: 'price_123' })
    expect(result.status).toBe('conflict')
    expect(result.message).toContain('billing issue')
    expect(mockCreateCheckoutSession).not.toHaveBeenCalled()
  })

  it('returns conflict when the user already has active Pro access', async () => {
    mockResolveProAccessBypassingCache.mockResolvedValue(true)
    const result = await call(CHECKOUT, { priceId: 'price_123' })
    expect(result.status).toBe('conflict')
    expect(mockValidateCheckoutEligibility).not.toHaveBeenCalled()
    expect(mockCreateCheckoutSession).not.toHaveBeenCalled()
  })

  it('returns too_many_requests when checkout rate limited', async () => {
    mockRateLimitRoute.mockResolvedValue(RATE_LIMITED)
    const result = await call(CHECKOUT, { priceId: 'price_123' })
    expect(result.status).toBe('too_many_requests')
    expect(mockRateLimitRoute).toHaveBeenCalledWith('stripeCheckout', 'user-1')
    expect(mockCreateCheckoutSession).not.toHaveBeenCalled()
  })

  it('creates session with correct params and returns the URL on success', async () => {
    mockGetUserStripeInfo.mockResolvedValue({ stripeCustomerId: 'cus_abc' })
    mockCreateCheckoutSession.mockResolvedValue({ url: 'https://checkout.stripe.com/pay/abc', id: 'cs_abc' })
    const result = await call(CHECKOUT, { priceId: 'price_123' })
    expect(mockEnsureStripeCustomerUserId).toHaveBeenCalledWith('cus_abc', 'user-1')
    expect(mockCancelIncompleteSubscriptionsForCustomer).toHaveBeenCalledWith('cus_abc')
    expect(mockCreateCheckoutSession).toHaveBeenCalledWith(
      expect.objectContaining({ priceId: 'price_123', userId: 'user-1', userEmail: 'a@b.com', customerId: 'cus_abc' }),
    )
    expect(result.status).toBe('ok')
    expect(result.data.url).toBe('https://checkout.stripe.com/pay/abc')
  })

  it('creates session without customerId when the user has no Stripe customer yet', async () => {
    mockGetUserStripeInfo.mockResolvedValue({ stripeCustomerId: null })
    mockCreateCheckoutSession.mockResolvedValue({ url: 'https://checkout.stripe.com/pay/abc', id: 'cs_abc' })
    await call(CHECKOUT, { priceId: 'price_123' })
    expect(mockCreateCheckoutSession).toHaveBeenCalledWith(expect.objectContaining({ customerId: undefined }))
  })

  it('reuses a recovered Stripe customer ID when eligibility lookup found one', async () => {
    mockGetUserStripeInfo.mockResolvedValue({ stripeCustomerId: null })
    mockValidateCheckoutEligibility.mockResolvedValue({ status: 'ok', customerId: 'cus_recovered' })
    mockCreateCheckoutSession.mockResolvedValue({ url: 'https://checkout.stripe.com/pay/abc', id: 'cs_abc' })
    await call(CHECKOUT, { priceId: 'price_123' })
    expect(mockEnsureStripeCustomerUserId).toHaveBeenCalledWith('cus_recovered', 'user-1')
    expect(mockCancelIncompleteSubscriptionsForCustomer).toHaveBeenCalledWith('cus_recovered')
    expect(mockCreateCheckoutSession).toHaveBeenCalledWith(expect.objectContaining({ customerId: 'cus_recovered' }))
  })

  it('does not cancel incomplete subscriptions when no Stripe customer exists yet', async () => {
    mockGetUserStripeInfo.mockResolvedValue({ stripeCustomerId: null })
    mockCreateCheckoutSession.mockResolvedValue({ url: 'https://checkout.stripe.com/pay/abc', id: 'cs_abc' })
    await call(CHECKOUT, { priceId: 'price_123' })
    expect(mockCancelIncompleteSubscriptionsForCustomer).not.toHaveBeenCalled()
  })

  it('returns internal_error when eligibility check fails', async () => {
    mockValidateCheckoutEligibility.mockResolvedValue({ status: 'error' })
    const result = await call(CHECKOUT, { priceId: 'price_123' })
    expect(result.status).toBe('internal_error')
    expect(mockCreateCheckoutSession).not.toHaveBeenCalled()
  })

  it('returns conflict when Stripe customer is linked to another user', async () => {
    mockValidateCheckoutEligibility.mockResolvedValue({ status: 'ok', customerId: 'cus_other' })
    mockEnsureStripeCustomerUserId.mockResolvedValue(false)
    const result = await call(CHECKOUT, { priceId: 'price_123' })
    expect(result.status).toBe('conflict')
    expect(result.message).toContain('linked to another user')
    expect(mockCreateCheckoutSession).not.toHaveBeenCalled()
  })
})

describe('POST /api/billing/portal', () => {
  it('returns unauthorized when not signed in', async () => {
    mockAuth.mockResolvedValue(null)
    expect((await call(PORTAL)).status).toBe('unauthorized')
  })

  it('returns bad_request when user has no stripeCustomerId', async () => {
    mockGetUserStripeInfo.mockResolvedValue({ stripeCustomerId: null })
    expect((await call(PORTAL)).status).toBe('bad_request')
  })

  it('returns too_many_requests when rate limited', async () => {
    mockRateLimitRoute.mockResolvedValue(RATE_LIMITED)
    const result = await call(PORTAL)
    expect(result.status).toBe('too_many_requests')
    expect(mockRateLimitRoute).toHaveBeenCalledWith('stripePortal', 'user-1')
    expect(mockCreatePortalSession).not.toHaveBeenCalled()
  })

  it('returns internal_error when portal session returns no URL', async () => {
    mockGetUserStripeInfo.mockResolvedValue({ stripeCustomerId: 'cus_abc' })
    mockCreatePortalSession.mockResolvedValue({ url: null })
    expect((await call(PORTAL)).status).toBe('internal_error')
  })

  it('returns internal_error when Stripe API throws', async () => {
    mockGetUserStripeInfo.mockResolvedValue({ stripeCustomerId: 'cus_abc' })
    mockCreatePortalSession.mockRejectedValue(new Error('Stripe network error'))
    const result = await call(PORTAL)
    expect(result.status).toBe('internal_error')
    expect(result.message).toContain('Unable to open billing portal')
  })

  it('creates portal session with correct customer ID and returns the URL on success', async () => {
    mockGetUserStripeInfo.mockResolvedValue({ stripeCustomerId: 'cus_abc' })
    mockCreatePortalSession.mockResolvedValue({ url: 'https://billing.stripe.com/session/abc' })
    const result = await call(PORTAL)
    expect(mockCreatePortalSession).toHaveBeenCalledWith('cus_abc', expect.stringContaining('/settings'))
    expect(result.status).toBe('ok')
    expect(result.data.url).toBe('https://billing.stripe.com/session/abc')
  })
})

describe('POST /api/billing/cancel', () => {
  beforeEach(() => mockSetCancelAtPeriodEnd.mockResolvedValue(undefined))

  it('returns unauthorized when not signed in', async () => {
    mockAuth.mockResolvedValue(null)
    expect((await call(CANCEL)).status).toBe('unauthorized')
  })

  it('returns bad_request when user has no subscription', async () => {
    mockGetUserStripeInfo.mockResolvedValue({ stripeSubscriptionId: null })
    expect((await call(CANCEL)).status).toBe('bad_request')
  })

  it('returns too_many_requests when rate limited', async () => {
    mockGetUserStripeInfo.mockResolvedValue({ stripeSubscriptionId: 'sub_abc', stripeCustomerId: 'cus_abc' })
    mockRateLimitRoute.mockResolvedValue(RATE_LIMITED)
    const result = await call(CANCEL)
    expect(result.status).toBe('too_many_requests')
    expect(mockRateLimitRoute).toHaveBeenCalledWith('stripeSubscription', 'user-1')
    expect(mockSetCancelAtPeriodEnd).not.toHaveBeenCalled()
  })

  it('returns internal_error and attempts recovery when a Stripe call throws after cancel', async () => {
    mockGetUserStripeInfo.mockResolvedValue({ stripeSubscriptionId: 'sub_abc', stripeCustomerId: 'cus_abc' })
    mockGetCachedLiveSubscriptionState.mockRejectedValue(new Error('Stripe error'))
    const result = await call(CANCEL)
    expect(result.status).toBe('internal_error')
    expect(result.message).toContain('Unable to cancel')
    expect(mockSetCancelAtPeriodEnd).toHaveBeenCalledWith('sub_abc', true)
    expect(mockSyncSubscriptionStateForUser).toHaveBeenCalledWith('user-1')
  })

  it('returns internal_error when live Stripe state cannot be fetched after cancel', async () => {
    mockGetUserStripeInfo.mockResolvedValue({ stripeSubscriptionId: 'sub_abc', stripeCustomerId: 'cus_abc' })
    mockGetCachedLiveSubscriptionState.mockResolvedValue(null)
    const result = await call(CANCEL)
    expect(result.status).toBe('internal_error')
    expect(mockSetCancelAtPeriodEnd).toHaveBeenCalledWith('sub_abc', true)
  })

  it('attempts billing sync recovery when DB persist fails after cancel', async () => {
    mockGetUserStripeInfo.mockResolvedValue({ stripeSubscriptionId: 'sub_abc', stripeCustomerId: 'cus_abc' })
    mockApplyLiveSubscriptionAccessFromStripe.mockRejectedValue(new Error('DB write failed'))
    const result = await call(CANCEL)
    expect(result.status).toBe('internal_error')
    expect(mockSyncSubscriptionStateForUser).toHaveBeenCalledWith('user-1')
    expect(result.message).toContain('refresh billing settings')
  })

  it('cancels subscription and syncs live Stripe state to the DB on success', async () => {
    mockGetUserStripeInfo.mockResolvedValue({ stripeSubscriptionId: 'sub_abc', stripeCustomerId: 'cus_abc' })
    const liveState = {
      exists: true,
      cancelAtPeriodEnd: true,
      currentPeriodEnd: new Date('2026-07-01T00:00:00.000Z'),
      interval: 'month' as const,
      status: 'active' as const,
    }
    mockGetCachedLiveSubscriptionState.mockResolvedValue(liveState)
    const result = await call(CANCEL)
    expect(result.status).toBe('ok')
    expect(mockSetCancelAtPeriodEnd).toHaveBeenCalledWith('sub_abc', true)
    expect(mockApplyLiveSubscriptionAccessFromStripe).toHaveBeenCalledWith('sub_abc', liveState, { userId: 'user-1', customerId: 'cus_abc' })
  })
})

describe('POST /api/billing/reactivate', () => {
  beforeEach(() => mockSetCancelAtPeriodEnd.mockResolvedValue(undefined))

  it('returns unauthorized when not signed in', async () => {
    mockAuth.mockResolvedValue(null)
    expect((await call(REACTIVATE)).status).toBe('unauthorized')
  })

  it('returns bad_request when user has no subscription', async () => {
    mockGetUserStripeInfo.mockResolvedValue({ stripeSubscriptionId: null })
    expect((await call(REACTIVATE)).status).toBe('bad_request')
  })

  it('reactivates subscription and syncs live Stripe state to the DB on success', async () => {
    mockGetUserStripeInfo.mockResolvedValue({ stripeSubscriptionId: 'sub_abc', stripeCustomerId: 'cus_abc' })
    const result = await call(REACTIVATE)
    expect(result.status).toBe('ok')
    expect(mockSetCancelAtPeriodEnd).toHaveBeenCalledWith('sub_abc', false)
    expect(mockApplyLiveSubscriptionAccessFromStripe).toHaveBeenCalledWith(
      'sub_abc',
      expect.objectContaining({ cancelAtPeriodEnd: false }),
      { userId: 'user-1', customerId: 'cus_abc' },
    )
  })
})
