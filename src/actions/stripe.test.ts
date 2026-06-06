import { vi, describe, it, expect, beforeEach } from 'vitest'

vi.mock('@/lib/session', () => {
  const getSession = vi.fn()
  return {
    getSession,
    withAuth: async (fn: (ctx: { userId: string; isPro: boolean }) => Promise<unknown>) => {
      const session = await getSession() as { user?: { id?: string; isPro?: boolean } } | null
      if (!session?.user?.id) return { status: 'unauthorized', data: null, message: 'Not authenticated.' }
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
  setSubscriptionCancelAtPeriodEnd: vi.fn(),
  fetchLiveSubscriptionState: vi.fn(),
}))
vi.mock('@/lib/db/stripe', () => ({
  getUserStripeInfo: vi.fn(),
  updateSubscriptionState: vi.fn(),
}))
vi.mock('@/lib/logger', () => ({
  createLogger: () => ({ info: vi.fn(), error: vi.fn(), warn: vi.fn() }),
}))
vi.mock('@/lib/utils/url', () => ({ getBaseUrl: vi.fn(() => 'https://devstash.io') }))
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))

import { redirect } from 'next/navigation'
import { getSession } from '@/lib/session'
import { createCheckoutSession, createPortalSession, setSubscriptionCancelAtPeriodEnd, fetchLiveSubscriptionState } from '@/lib/stripe'
import { getUserStripeInfo, updateSubscriptionState } from '@/lib/db/stripe'
import {
  createCheckoutSessionAction,
  createPortalSessionAction,
  cancelSubscriptionAction,
  reactivateSubscriptionAction,
  syncSubscriptionStateAction,
} from './stripe'

const mockGetSession = getSession as ReturnType<typeof vi.fn>
const mockCreateCheckoutSession = createCheckoutSession as ReturnType<typeof vi.fn>
const mockCreatePortalSession = createPortalSession as ReturnType<typeof vi.fn>
const mockSetCancelAtPeriodEnd = setSubscriptionCancelAtPeriodEnd as ReturnType<typeof vi.fn>
const mockFetchLiveSubscriptionState = fetchLiveSubscriptionState as ReturnType<typeof vi.fn>
const mockGetUserStripeInfo = getUserStripeInfo as ReturnType<typeof vi.fn>
const mockUpdateSubscriptionState = updateSubscriptionState as ReturnType<typeof vi.fn>
const mockRedirect = redirect as unknown as ReturnType<typeof vi.fn>

beforeEach(() => {
  vi.clearAllMocks()
})

describe('createCheckoutSessionAction', () => {
  it('returns unauthorized when not signed in', async () => {
    mockGetSession.mockResolvedValue(null)
    const result = await createCheckoutSessionAction('price_123')
    expect(result.status).toBe('unauthorized')
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

  it('creates session with correct params and redirects on success', async () => {
    mockGetSession.mockResolvedValue({ user: { id: 'user-1', email: 'a@b.com' } })
    mockCreateCheckoutSession.mockResolvedValue({ url: 'https://checkout.stripe.com/pay/abc', id: 'cs_abc' })

    await createCheckoutSessionAction('price_123')

    expect(mockCreateCheckoutSession).toHaveBeenCalledWith(
      expect.objectContaining({
        priceId: 'price_123',
        userId: 'user-1',
        userEmail: 'a@b.com',
      })
    )
    expect(mockRedirect).toHaveBeenCalledWith('https://checkout.stripe.com/pay/abc')
  })
})

describe('createPortalSessionAction', () => {
  it('returns unauthorized when not signed in', async () => {
    mockGetSession.mockResolvedValue(null)
    const result = await createPortalSessionAction()
    expect(result.status).toBe('unauthorized')
  })

  it('returns bad_request when user has no stripeCustomerId', async () => {
    mockGetSession.mockResolvedValue({ user: { id: 'user-1' } })
    mockGetUserStripeInfo.mockResolvedValue({ stripeCustomerId: null })
    const result = await createPortalSessionAction()
    expect(result.status).toBe('bad_request')
  })

  it('returns internal_error when portal session returns no URL', async () => {
    mockGetSession.mockResolvedValue({ user: { id: 'user-1' } })
    mockGetUserStripeInfo.mockResolvedValue({ stripeCustomerId: 'cus_abc' })
    mockCreatePortalSession.mockResolvedValue({ url: null })
    const result = await createPortalSessionAction()
    expect(result.status).toBe('internal_error')
  })

  it('returns internal_error when Stripe API throws', async () => {
    mockGetSession.mockResolvedValue({ user: { id: 'user-1' } })
    mockGetUserStripeInfo.mockResolvedValue({ stripeCustomerId: 'cus_abc' })
    mockCreatePortalSession.mockRejectedValue(new Error('Stripe network error'))
    const result = await createPortalSessionAction()
    expect(result.status).toBe('internal_error')
    expect(result.message).toContain('Unable to open billing portal')
  })

  it('creates portal session with correct customer ID and redirects on success', async () => {
    mockGetSession.mockResolvedValue({ user: { id: 'user-1' } })
    mockGetUserStripeInfo.mockResolvedValue({ stripeCustomerId: 'cus_abc' })
    mockCreatePortalSession.mockResolvedValue({ url: 'https://billing.stripe.com/session/abc' })

    await createPortalSessionAction()

    expect(mockCreatePortalSession).toHaveBeenCalledWith('cus_abc', expect.stringContaining('/settings'))
    expect(mockRedirect).toHaveBeenCalledWith('https://billing.stripe.com/session/abc')
  })
})

describe('cancelSubscriptionAction', () => {
  it('returns unauthorized when not signed in', async () => {
    mockGetSession.mockResolvedValue(null)
    const result = await cancelSubscriptionAction()
    expect(result.status).toBe('unauthorized')
  })

  it('returns bad_request when user has no subscription', async () => {
    mockGetSession.mockResolvedValue({ user: { id: 'user-1' } })
    mockGetUserStripeInfo.mockResolvedValue({ stripeSubscriptionId: null })
    const result = await cancelSubscriptionAction()
    expect(result.status).toBe('bad_request')
  })

  it('returns internal_error when Stripe API throws', async () => {
    mockGetSession.mockResolvedValue({ user: { id: 'user-1' } })
    mockGetUserStripeInfo.mockResolvedValue({ stripeSubscriptionId: 'sub_abc' })
    mockSetCancelAtPeriodEnd.mockRejectedValue(new Error('Stripe error'))
    const result = await cancelSubscriptionAction()
    expect(result.status).toBe('internal_error')
    expect(result.message).toContain('Unable to cancel')
  })

  it('cancels subscription and updates DB on success', async () => {
    mockGetSession.mockResolvedValue({ user: { id: 'user-1' } })
    mockGetUserStripeInfo.mockResolvedValue({ stripeSubscriptionId: 'sub_abc' })
    mockSetCancelAtPeriodEnd.mockResolvedValue(undefined)
    mockUpdateSubscriptionState.mockResolvedValue({ count: 1 })

    const result = await cancelSubscriptionAction()

    expect(result.status).toBe('ok')
    expect(mockSetCancelAtPeriodEnd).toHaveBeenCalledWith('sub_abc', true)
    expect(mockUpdateSubscriptionState).toHaveBeenCalledWith('sub_abc', { cancelAtPeriodEnd: true })
  })
})

describe('reactivateSubscriptionAction', () => {
  it('returns unauthorized when not signed in', async () => {
    mockGetSession.mockResolvedValue(null)
    const result = await reactivateSubscriptionAction()
    expect(result.status).toBe('unauthorized')
  })

  it('returns bad_request when user has no subscription', async () => {
    mockGetSession.mockResolvedValue({ user: { id: 'user-1' } })
    mockGetUserStripeInfo.mockResolvedValue({ stripeSubscriptionId: null })
    const result = await reactivateSubscriptionAction()
    expect(result.status).toBe('bad_request')
  })

  it('reactivates subscription and updates DB on success', async () => {
    mockGetSession.mockResolvedValue({ user: { id: 'user-1' } })
    mockGetUserStripeInfo.mockResolvedValue({ stripeSubscriptionId: 'sub_abc' })
    mockSetCancelAtPeriodEnd.mockResolvedValue(undefined)
    mockUpdateSubscriptionState.mockResolvedValue({ count: 1 })

    const result = await reactivateSubscriptionAction()

    expect(result.status).toBe('ok')
    expect(mockSetCancelAtPeriodEnd).toHaveBeenCalledWith('sub_abc', false)
    expect(mockUpdateSubscriptionState).toHaveBeenCalledWith('sub_abc', { cancelAtPeriodEnd: false })
  })
})

describe('syncSubscriptionStateAction', () => {
  it('returns unauthorized when not signed in', async () => {
    mockGetSession.mockResolvedValue(null)
    const result = await syncSubscriptionStateAction()
    expect(result.status).toBe('unauthorized')
  })

  it('returns ok without writing when user has no subscription', async () => {
    mockGetSession.mockResolvedValue({ user: { id: 'user-1' } })
    mockGetUserStripeInfo.mockResolvedValue({ stripeSubscriptionId: null })
    const result = await syncSubscriptionStateAction()
    expect(result.status).toBe('ok')
    expect(mockUpdateSubscriptionState).not.toHaveBeenCalled()
  })

  it('returns ok without writing when live state is unavailable', async () => {
    mockGetSession.mockResolvedValue({ user: { id: 'user-1' } })
    mockGetUserStripeInfo.mockResolvedValue({ stripeSubscriptionId: 'sub_abc' })
    mockFetchLiveSubscriptionState.mockResolvedValue(null)
    const result = await syncSubscriptionStateAction()
    expect(result.status).toBe('ok')
    expect(mockUpdateSubscriptionState).not.toHaveBeenCalled()
  })

  it('writes live state to DB on success', async () => {
    mockGetSession.mockResolvedValue({ user: { id: 'user-1' } })
    mockGetUserStripeInfo.mockResolvedValue({ stripeSubscriptionId: 'sub_abc' })
    const periodEnd = new Date('2026-12-31')
    mockFetchLiveSubscriptionState.mockResolvedValue({
      cancelAtPeriodEnd: false,
      currentPeriodEnd: periodEnd,
      interval: 'month',
    })
    mockUpdateSubscriptionState.mockResolvedValue({ count: 1 })

    const result = await syncSubscriptionStateAction()

    expect(result.status).toBe('ok')
    expect(mockUpdateSubscriptionState).toHaveBeenCalledWith(
      'sub_abc',
      expect.objectContaining({ cancelAtPeriodEnd: false, currentPeriodEnd: periodEnd, subscriptionInterval: 'month' })
    )
  })
})
