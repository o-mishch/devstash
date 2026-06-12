import { vi, describe, it, expect, beforeEach } from 'vitest'
import type { RateLimitKey } from '@/lib/infra/rate-limit'

vi.mock('@/lib/session', async () => {
  const { rateLimitAction } = await import('@/lib/infra/rate-limit')
  const getSession = vi.fn()

  return {
    getSession,
    requireAuthSession: async () => {
      const session = await getSession() as { user?: { id?: string; email?: string | null } } | null
      if (!session?.user?.id) return null
      return { userId: session.user.id, email: session.user.email }
    },
    requireAuthSessionWithRateLimit: async (rateLimitKey: RateLimitKey) => {
      const session = await getSession() as { user?: { id?: string; email?: string | null } } | null
      if (!session?.user?.id) {
        return { ok: false as const, response: { status: 'unauthorized', data: null, message: null } }
      }
      const rateLimit = await rateLimitAction(rateLimitKey, session.user.id)
      if (rateLimit) {
        return { ok: false as const, response: rateLimit }
      }
      return {
        ok: true as const,
        session: { userId: session.user.id, email: session.user.email },
      }
    },
    withAuth: async (fn: (ctx: { userId: string; isPro: boolean }) => Promise<unknown>) => {
      const session = await getSession() as { user?: { id?: string; isPro?: boolean } } | null
      if (!session?.user?.id) return { status: 'unauthorized', data: null, message: 'Not authenticated.' }
      try {
        return await fn({ userId: session.user.id, isPro: session.user.isPro ?? false })
      } catch {
        return { status: 'internal_error', data: null, message: null }
      }
    },
    withAuthAndRateLimit: async (
      rateLimitKey: RateLimitKey,
      fn: (ctx: { userId: string; isPro: boolean }) => Promise<unknown>,
    ) => {
      const session = await getSession() as { user?: { id?: string; isPro?: boolean } } | null
      if (!session?.user?.id) return { status: 'unauthorized', data: null, message: 'Not authenticated.' }
      const rateLimit = await rateLimitAction(rateLimitKey, session.user.id)
      if (rateLimit) return rateLimit
      try {
        return await fn({ userId: session.user.id, isPro: session.user.isPro ?? false })
      } catch {
        return { status: 'internal_error', data: null, message: null }
      }
    },
  }
})
vi.mock('@/lib/stripe', () => ({
  createCheckoutSession: vi.fn(),
  createPortalSession: vi.fn(),
  ensureStripeCustomerUserId: vi.fn(),
  setSubscriptionCancelAtPeriodEnd: vi.fn(),
}))
const { mockGetUserStripeInfo } = vi.hoisted(() => ({
  mockGetUserStripeInfo: vi.fn(),
}))

vi.mock('@/lib/db/stripe', () => ({
  getUserStripeInfo: mockGetUserStripeInfo,
}))

vi.mock('@/lib/billing/sync/user-billing-state', () => ({
  getCachedUserStripeInfo: mockGetUserStripeInfo,
  getFreshUserStripeInfo: mockGetUserStripeInfo,
  getCachedLiveSubscriptionState: vi.fn(),
}))
vi.mock('@/lib/billing/access/pro-access-resolution', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/billing/access/pro-access-resolution')>()
  return {
    ...actual,
    resolveProAccessBypassingCache: vi.fn(),
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
  return {
    ...actual,
    isStripeCheckoutConfigured: vi.fn(() => true),
  }
})
vi.mock('@/lib/infra/logger', () => ({
  createLogger: () => ({ info: vi.fn(), error: vi.fn(), warn: vi.fn() }),
}))
vi.mock('@/lib/infra/rate-limit', () => ({
  rateLimitAction: vi.fn(async () => null),
}))
vi.mock('@/lib/utils/url', () => ({ getBaseUrl: vi.fn(() => 'https://devstash.io') }))
vi.mock('next/cache', () => ({
  revalidatePath: vi.fn(),
  revalidateTag: vi.fn(),
  unstable_cache: <T extends (...args: never[]) => Promise<unknown>>(fn: T) => fn,
}))

import { redirect } from 'next/navigation'
import { getSession } from '@/lib/session'
import {
  createCheckoutSession,
  createPortalSession,
  ensureStripeCustomerUserId,
  setSubscriptionCancelAtPeriodEnd,
} from '@/lib/stripe'
import { cancelIncompleteSubscriptionsForCustomer } from '@/lib/billing/checkout/stripe-checkout'
import { rateLimitAction } from '@/lib/infra/rate-limit'
import { getCachedLiveSubscriptionState } from '@/lib/billing/sync/user-billing-state'
import { resolveProAccessBypassingCache } from '@/lib/billing/access/pro-access-resolution'
import { applyLiveSubscriptionAccessFromStripe } from '@/lib/billing/subscription/stripe-subscription-persist'
import { validateCheckoutEligibility } from '@/lib/billing/checkout/stripe-checkout'
import { reconcileOrphanStripeSubscriptionForUser, syncSubscriptionStateForUser } from '@/lib/billing/sync/passive-billing-sync'
import { isStripeCheckoutConfigured } from '@/lib/billing/config/billing-pricing'
import {
  createCheckoutSessionAction,
  createCheckoutSessionFormAction,
  createPortalSessionAction,
  cancelSubscriptionAction,
  reactivateSubscriptionAction,
} from './billing'

const formActionArgs = [null, new FormData()] as const

const mockGetSession = getSession as ReturnType<typeof vi.fn>
const mockCancelIncompleteSubscriptionsForCustomer = cancelIncompleteSubscriptionsForCustomer as ReturnType<typeof vi.fn>
const mockEnsureStripeCustomerUserId = ensureStripeCustomerUserId as ReturnType<typeof vi.fn>
const mockCreateCheckoutSession = createCheckoutSession as ReturnType<typeof vi.fn>
const mockRateLimitAction = rateLimitAction as ReturnType<typeof vi.fn>
const mockCreatePortalSession = createPortalSession as ReturnType<typeof vi.fn>
const mockSetCancelAtPeriodEnd = setSubscriptionCancelAtPeriodEnd as ReturnType<typeof vi.fn>
const mockGetCachedLiveSubscriptionState = getCachedLiveSubscriptionState as ReturnType<typeof vi.fn>
const mockResolveProAccessBypassingCache = resolveProAccessBypassingCache as ReturnType<typeof vi.fn>
const mockApplyLiveSubscriptionAccessFromStripe = applyLiveSubscriptionAccessFromStripe as ReturnType<typeof vi.fn>
const mockValidateCheckoutEligibility = validateCheckoutEligibility as ReturnType<typeof vi.fn>
const mockReconcileOrphanStripeSubscriptionForUser = reconcileOrphanStripeSubscriptionForUser as ReturnType<typeof vi.fn>
const mockSyncSubscriptionStateForUser = syncSubscriptionStateForUser as ReturnType<typeof vi.fn>
const mockIsStripeCheckoutConfigured = isStripeCheckoutConfigured as ReturnType<typeof vi.fn>
const mockRedirect = redirect as unknown as ReturnType<typeof vi.fn>

beforeEach(() => {
  vi.clearAllMocks()
  process.env.STRIPE_PRICE_ID_MONTHLY = 'price_123'
  process.env.STRIPE_PRICE_ID_YEARLY = 'price_yearly'
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
  mockRateLimitAction.mockResolvedValue(null)
  mockRedirect.mockImplementation(() => undefined)
})

function setupStripeMocks(subscriptionId: string | null = 'sub_abc') {
  mockGetSession.mockResolvedValue({ user: { id: 'user-1' } })
  mockGetUserStripeInfo.mockResolvedValue({ stripeSubscriptionId: subscriptionId, stripeCustomerId: 'cus_abc' })
  mockSetCancelAtPeriodEnd.mockResolvedValue(undefined)
}

describe('createCheckoutSessionAction', () => {
  it('returns unauthorized when not signed in', async () => {
    mockGetSession.mockResolvedValue(null)
    const result = await createCheckoutSessionAction('price_123')
    expect(result.status).toBe('unauthorized')
  })

  it('returns internal_error when Stripe price IDs are not configured', async () => {
    mockGetSession.mockResolvedValue({ user: { id: 'user-1', email: 'a@b.com' } })
    mockIsStripeCheckoutConfigured.mockReturnValue(false)

    const result = await createCheckoutSessionAction('price_123')

    expect(result.status).toBe('internal_error')
    expect(result.message).toContain('Billing is temporarily unavailable')
    expect(mockValidateCheckoutEligibility).not.toHaveBeenCalled()
    expect(mockCreateCheckoutSession).not.toHaveBeenCalled()
  })

  it('returns internal_error when Stripe returns no session URL', async () => {
    mockGetSession.mockResolvedValue({ user: { id: 'user-1', email: 'a@b.com' } })
    mockCreateCheckoutSession.mockResolvedValue({ url: null, id: 'cs_test' })
    const result = await createCheckoutSessionAction('price_123')
    expect(result.status).toBe('internal_error')
  })

  it('returns internal_error when Stripe API throws', async () => {
    mockGetSession.mockResolvedValue({ user: { id: 'user-1', email: 'a@b.com' } })
    mockCreateCheckoutSession.mockRejectedValue(new Error('Stripe network error'))
    const result = await createCheckoutSessionAction('price_123')
    expect(result.status).toBe('internal_error')
    expect(result.message).toContain('Unable to start checkout')
  })

  it('returns bad_request when the price ID is not allowed', async () => {
    mockGetSession.mockResolvedValue({ user: { id: 'user-1', email: 'a@b.com' } })
    mockValidateCheckoutEligibility.mockResolvedValue({ status: 'invalid_price' })

    const result = await createCheckoutSessionAction('price_bad')

    expect(result.status).toBe('validation_error')
    expect(mockCreateCheckoutSession).not.toHaveBeenCalled()
  })

  it('returns conflict when the customer already has a subscription', async () => {
    mockGetSession.mockResolvedValue({ user: { id: 'user-1', email: 'a@b.com' } })
    mockValidateCheckoutEligibility.mockResolvedValue({
      status: 'existing_subscription',
      subscriptionId: 'sub_abc',
      subscriptionStatus: 'active',
    })
    mockReconcileOrphanStripeSubscriptionForUser.mockResolvedValue(false)

    const result = await createCheckoutSessionAction('price_123')

    expect(result.status).toBe('conflict')
    expect(result.message).toContain('Manage it from Billing settings')
    expect(mockReconcileOrphanStripeSubscriptionForUser).toHaveBeenCalledWith('user-1', undefined)
    expect(mockCreateCheckoutSession).not.toHaveBeenCalled()
  })

  it('redirects to settings when an orphan subscription is linked before checkout', async () => {
    const blockingSubscription = { id: 'sub_abc', status: 'active' }
    mockGetSession.mockResolvedValue({ user: { id: 'user-1', email: 'a@b.com' } })
    mockValidateCheckoutEligibility.mockResolvedValue({
      status: 'existing_subscription',
      customerId: 'cus_abc',
      subscriptionId: 'sub_abc',
      subscriptionStatus: 'active',
      blockingSubscription,
    })
    mockReconcileOrphanStripeSubscriptionForUser.mockResolvedValue(true)
    mockRedirect.mockImplementation(() => {
      throw new Error('NEXT_REDIRECT')
    })

    await expect(createCheckoutSessionAction('price_123')).rejects.toThrow('NEXT_REDIRECT')
    expect(mockReconcileOrphanStripeSubscriptionForUser).toHaveBeenCalledWith('user-1', {
      customerId: 'cus_abc',
      blockingSubscription,
    })
    expect(mockRedirect).toHaveBeenCalledWith('https://devstash.io/api/billing/checkout-return')
  })

  it('returns a billing recovery message when the subscription is past due', async () => {
    mockGetSession.mockResolvedValue({ user: { id: 'user-1', email: 'a@b.com' } })
    mockValidateCheckoutEligibility.mockResolvedValue({
      status: 'existing_subscription',
      subscriptionId: 'sub_abc',
      subscriptionStatus: 'past_due',
    })

    const result = await createCheckoutSessionAction('price_123')

    expect(result.status).toBe('conflict')
    expect(result.message).toContain('billing issue')
    expect(mockCreateCheckoutSession).not.toHaveBeenCalled()
  })

  it('returns conflict when the user already has active Pro access', async () => {
    mockGetSession.mockResolvedValue({ user: { id: 'user-1', email: 'a@b.com' } })
    mockResolveProAccessBypassingCache.mockResolvedValue(true)

    const result = await createCheckoutSessionAction('price_123')

    expect(result.status).toBe('conflict')
    expect(mockValidateCheckoutEligibility).not.toHaveBeenCalled()
    expect(mockCreateCheckoutSession).not.toHaveBeenCalled()
  })

  it('returns too_many_requests when checkout rate limited', async () => {
    mockGetSession.mockResolvedValue({ user: { id: 'user-1', email: 'a@b.com' } })
    mockRateLimitAction.mockResolvedValue({
      status: 'too_many_requests',
      data: null,
      message: 'Too many requests.',
    })

    const result = await createCheckoutSessionAction('price_123')

    expect(result.status).toBe('too_many_requests')
    expect(mockRateLimitAction).toHaveBeenCalledWith('stripeCheckout', 'user-1')
    expect(mockCreateCheckoutSession).not.toHaveBeenCalled()
  })

  it('creates session with correct params and redirects on success', async () => {
    mockGetSession.mockResolvedValue({ user: { id: 'user-1', email: 'a@b.com' } })
    mockGetUserStripeInfo.mockResolvedValue({ stripeCustomerId: 'cus_abc' })
    mockCreateCheckoutSession.mockResolvedValue({ url: 'https://checkout.stripe.com/pay/abc', id: 'cs_abc' })

    await createCheckoutSessionAction('price_123')

    expect(mockEnsureStripeCustomerUserId).toHaveBeenCalledWith('cus_abc', 'user-1')
    expect(mockCancelIncompleteSubscriptionsForCustomer).toHaveBeenCalledWith('cus_abc')
    expect(mockCreateCheckoutSession).toHaveBeenCalledWith(
      expect.objectContaining({
        priceId: 'price_123',
        userId: 'user-1',
        userEmail: 'a@b.com',
        customerId: 'cus_abc',
      })
    )
    expect(mockRedirect).toHaveBeenCalledWith('https://checkout.stripe.com/pay/abc')
  })

  it('creates session without customerId when the user has no Stripe customer yet', async () => {
    mockGetSession.mockResolvedValue({ user: { id: 'user-1', email: 'a@b.com' } })
    mockGetUserStripeInfo.mockResolvedValue({ stripeCustomerId: null })
    mockCreateCheckoutSession.mockResolvedValue({ url: 'https://checkout.stripe.com/pay/abc', id: 'cs_abc' })

    await createCheckoutSessionAction('price_123')

    expect(mockCreateCheckoutSession).toHaveBeenCalledWith(
      expect.objectContaining({
        customerId: undefined,
      })
    )
  })

  it('reuses a recovered Stripe customer ID when eligibility lookup found one', async () => {
    mockGetSession.mockResolvedValue({ user: { id: 'user-1', email: 'a@b.com' } })
    mockGetUserStripeInfo.mockResolvedValue({ stripeCustomerId: null })
    mockValidateCheckoutEligibility.mockResolvedValue({ status: 'ok', customerId: 'cus_recovered' })
    mockCreateCheckoutSession.mockResolvedValue({ url: 'https://checkout.stripe.com/pay/abc', id: 'cs_abc' })

    await createCheckoutSessionAction('price_123')

    expect(mockEnsureStripeCustomerUserId).toHaveBeenCalledWith('cus_recovered', 'user-1')
    expect(mockCancelIncompleteSubscriptionsForCustomer).toHaveBeenCalledWith('cus_recovered')
    expect(mockCreateCheckoutSession).toHaveBeenCalledWith(
      expect.objectContaining({
        customerId: 'cus_recovered',
      })
    )
  })

  it('does not cancel incomplete subscriptions when no Stripe customer exists yet', async () => {
    mockGetSession.mockResolvedValue({ user: { id: 'user-1', email: 'a@b.com' } })
    mockGetUserStripeInfo.mockResolvedValue({ stripeCustomerId: null })
    mockCreateCheckoutSession.mockResolvedValue({ url: 'https://checkout.stripe.com/pay/abc', id: 'cs_abc' })

    await createCheckoutSessionAction('price_123')

    expect(mockCancelIncompleteSubscriptionsForCustomer).not.toHaveBeenCalled()
  })

  it('returns internal_error when eligibility check fails', async () => {
    mockGetSession.mockResolvedValue({ user: { id: 'user-1', email: 'a@b.com' } })
    mockValidateCheckoutEligibility.mockResolvedValue({ status: 'error' })

    const result = await createCheckoutSessionAction('price_123')

    expect(result.status).toBe('internal_error')
    expect(mockCreateCheckoutSession).not.toHaveBeenCalled()
  })

  it('returns conflict when Stripe customer is linked to another user', async () => {
    mockGetSession.mockResolvedValue({ user: { id: 'user-1', email: 'a@b.com' } })
    mockValidateCheckoutEligibility.mockResolvedValue({ status: 'ok', customerId: 'cus_other' })
    mockEnsureStripeCustomerUserId.mockResolvedValue(false)

    const result = await createCheckoutSessionAction('price_123')

    expect(result.status).toBe('conflict')
    expect(result.message).toContain('linked to another user')
    expect(mockCreateCheckoutSession).not.toHaveBeenCalled()
  })
})

describe('createCheckoutSessionFormAction', () => {
  it('returns validation_error when priceId is missing', async () => {
    const result = await createCheckoutSessionFormAction(null, new FormData())

    expect(result.status).toBe('validation_error')
    expect(mockCreateCheckoutSession).not.toHaveBeenCalled()
  })

  it('returns validation_error when priceId is not allowed', async () => {
    mockGetSession.mockResolvedValue({ user: { id: 'user-1', email: 'user@example.com' } })

    const form = new FormData()
    form.set('priceId', 'price_not_allowed')
    const result = await createCheckoutSessionFormAction(null, form)

    expect(result.status).toBe('validation_error')
    expect(mockCreateCheckoutSession).not.toHaveBeenCalled()
    expect(mockValidateCheckoutEligibility).not.toHaveBeenCalled()
  })
})

describe('createPortalSessionAction', () => {
  it('returns unauthorized when not signed in', async () => {
    mockGetSession.mockResolvedValue(null)
    const result = await createPortalSessionAction(...formActionArgs)
    expect(result.status).toBe('unauthorized')
  })

  it('returns bad_request when user has no stripeCustomerId', async () => {
    mockGetSession.mockResolvedValue({ user: { id: 'user-1' } })
    mockGetUserStripeInfo.mockResolvedValue({ stripeCustomerId: null })
    const result = await createPortalSessionAction(...formActionArgs)
    expect(result.status).toBe('bad_request')
  })

  it('returns too_many_requests when rate limited', async () => {
    mockGetSession.mockResolvedValue({ user: { id: 'user-1' } })
    mockRateLimitAction.mockResolvedValue({
      status: 'too_many_requests',
      data: null,
      message: 'Too many requests.',
    })

    const result = await createPortalSessionAction(...formActionArgs)

    expect(result.status).toBe('too_many_requests')
    expect(mockRateLimitAction).toHaveBeenCalledWith('stripePortal', 'user-1')
    expect(mockCreatePortalSession).not.toHaveBeenCalled()
  })

  it('returns internal_error when portal session returns no URL', async () => {
    mockGetSession.mockResolvedValue({ user: { id: 'user-1' } })
    mockGetUserStripeInfo.mockResolvedValue({ stripeCustomerId: 'cus_abc' })
    mockCreatePortalSession.mockResolvedValue({ url: null })
    const result = await createPortalSessionAction(...formActionArgs)
    expect(result.status).toBe('internal_error')
  })

  it('returns internal_error when Stripe API throws', async () => {
    mockGetSession.mockResolvedValue({ user: { id: 'user-1' } })
    mockGetUserStripeInfo.mockResolvedValue({ stripeCustomerId: 'cus_abc' })
    mockCreatePortalSession.mockRejectedValue(new Error('Stripe network error'))
    const result = await createPortalSessionAction(...formActionArgs)
    expect(result.status).toBe('internal_error')
    expect(result.message).toContain('Unable to open billing portal')
  })

  it('creates portal session with correct customer ID and redirects on success', async () => {
    mockGetSession.mockResolvedValue({ user: { id: 'user-1' } })
    mockGetUserStripeInfo.mockResolvedValue({ stripeCustomerId: 'cus_abc' })
    mockCreatePortalSession.mockResolvedValue({ url: 'https://billing.stripe.com/session/abc' })

    await createPortalSessionAction(...formActionArgs)

    expect(mockCreatePortalSession).toHaveBeenCalledWith('cus_abc', expect.stringContaining('/settings'))
    expect(mockRedirect).toHaveBeenCalledWith('https://billing.stripe.com/session/abc')
  })
})

describe('cancelSubscriptionAction', () => {
  it('returns unauthorized when not signed in', async () => {
    mockGetSession.mockResolvedValue(null)
    const result = await cancelSubscriptionAction(...formActionArgs)
    expect(result.status).toBe('unauthorized')
  })

  it('returns bad_request when user has no subscription', async () => {
    setupStripeMocks(null)
    const result = await cancelSubscriptionAction(...formActionArgs)
    expect(result.status).toBe('bad_request')
  })

  it('returns too_many_requests when rate limited', async () => {
    setupStripeMocks('sub_abc')
    mockRateLimitAction.mockResolvedValue({
      status: 'too_many_requests',
      data: null,
      message: 'Too many requests.',
    })

    const result = await cancelSubscriptionAction(...formActionArgs)

    expect(result.status).toBe('too_many_requests')
    expect(mockRateLimitAction).toHaveBeenCalledWith('stripeSubscription', 'user-1')
    expect(mockSetCancelAtPeriodEnd).not.toHaveBeenCalled()
  })

  it('returns internal_error when Stripe API throws', async () => {
    mockGetSession.mockResolvedValue({ user: { id: 'user-1' } })
    mockGetUserStripeInfo.mockResolvedValue({ stripeSubscriptionId: 'sub_abc' })
    mockSetCancelAtPeriodEnd.mockRejectedValue(new Error('Stripe error'))
    const result = await cancelSubscriptionAction(...formActionArgs)
    expect(result.status).toBe('internal_error')
    expect(result.message).toContain('Unable to cancel')
  })

  it('returns internal_error when live Stripe state cannot be fetched after cancel', async () => {
    setupStripeMocks('sub_abc')
    mockGetCachedLiveSubscriptionState.mockResolvedValue(null)

    const result = await cancelSubscriptionAction(...formActionArgs)

    expect(result.status).toBe('internal_error')
    expect(mockSetCancelAtPeriodEnd).toHaveBeenCalledWith('sub_abc', true)
  })

  it('attempts billing sync recovery when DB persist fails after cancel', async () => {
    setupStripeMocks('sub_abc')
    mockApplyLiveSubscriptionAccessFromStripe.mockRejectedValue(new Error('DB write failed'))

    const result = await cancelSubscriptionAction(...formActionArgs)

    expect(result.status).toBe('internal_error')
    expect(mockSyncSubscriptionStateForUser).toHaveBeenCalledWith('user-1')
    expect(result.message).toContain('refresh billing settings')
  })

  it('cancels subscription and syncs live Stripe state to the DB on success', async () => {
    setupStripeMocks('sub_abc')
    const liveState = {
      exists: true,
      cancelAtPeriodEnd: true,
      currentPeriodEnd: new Date('2026-07-01T00:00:00.000Z'),
      interval: 'month' as const,
      status: 'active' as const,
    }
    mockGetCachedLiveSubscriptionState.mockResolvedValue(liveState)

    const result = await cancelSubscriptionAction(...formActionArgs)

    expect(result.status).toBe('ok')
    expect(mockSetCancelAtPeriodEnd).toHaveBeenCalledWith('sub_abc', true)
    expect(mockGetCachedLiveSubscriptionState).toHaveBeenCalledWith('sub_abc')
    expect(mockApplyLiveSubscriptionAccessFromStripe).toHaveBeenCalledWith('sub_abc', liveState, {
      userId: 'user-1',
      customerId: 'cus_abc',
    })
  })
})

describe('reactivateSubscriptionAction', () => {
  it('returns unauthorized when not signed in', async () => {
    mockGetSession.mockResolvedValue(null)
    const result = await reactivateSubscriptionAction(...formActionArgs)
    expect(result.status).toBe('unauthorized')
  })

  it('returns bad_request when user has no subscription', async () => {
    setupStripeMocks(null)
    const result = await reactivateSubscriptionAction(...formActionArgs)
    expect(result.status).toBe('bad_request')
  })

  it('reactivates subscription and syncs live Stripe state to the DB on success', async () => {
    setupStripeMocks('sub_abc')

    const result = await reactivateSubscriptionAction(...formActionArgs)

    expect(result.status).toBe('ok')
    expect(mockSetCancelAtPeriodEnd).toHaveBeenCalledWith('sub_abc', false)
    expect(mockGetCachedLiveSubscriptionState).toHaveBeenCalledWith('sub_abc')
    expect(mockApplyLiveSubscriptionAccessFromStripe).toHaveBeenCalledWith(
      'sub_abc',
      expect.objectContaining({ cancelAtPeriodEnd: false }),
      { userId: 'user-1', customerId: 'cus_abc' },
    )
  })
})

