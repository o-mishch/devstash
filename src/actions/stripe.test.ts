import { vi, describe, it, expect, beforeEach } from 'vitest'

vi.mock('@/lib/session', () => ({ getSession: vi.fn() }))
vi.mock('@/lib/stripe', () => ({
  stripe: {
    checkout: { sessions: { create: vi.fn() } },
    billingPortal: { sessions: { create: vi.fn() } },
  },
}))
vi.mock('@/lib/db/stripe', () => ({ getUserStripeCustomerId: vi.fn() }))
vi.mock('@/lib/logger', () => ({
  createLogger: () => ({ info: vi.fn(), error: vi.fn(), warn: vi.fn() }),
}))
vi.mock('@/lib/utils/url', () => ({ getBaseUrl: vi.fn(() => 'https://devstash.io') }))

import { redirect } from 'next/navigation'
import { getSession } from '@/lib/session'
import { stripe } from '@/lib/stripe'
import { getUserStripeCustomerId } from '@/lib/db/stripe'
import { createCheckoutSessionAction, createPortalSessionAction } from './stripe'

const mockGetSession = getSession as ReturnType<typeof vi.fn>
const mockCheckoutCreate = stripe.checkout.sessions.create as ReturnType<typeof vi.fn>
const mockPortalCreate = stripe.billingPortal.sessions.create as ReturnType<typeof vi.fn>
const mockGetUserStripeCustomerId = getUserStripeCustomerId as ReturnType<typeof vi.fn>
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
    mockCheckoutCreate.mockResolvedValue({ url: null })
    const result = await createCheckoutSessionAction('price_123')
    expect(result.status).toBe('internal_error')
  })

  it('returns internal_error when Stripe API throws', async () => {
    mockGetSession.mockResolvedValue({ user: { id: 'user-1', email: 'a@b.com' } })
    mockCheckoutCreate.mockRejectedValue(new Error('Stripe network error'))
    const result = await createCheckoutSessionAction('price_123')
    expect(result.status).toBe('internal_error')
    expect(result.message).toContain('Unable to start checkout')
  })

  it('creates session with correct params and redirects on success', async () => {
    mockGetSession.mockResolvedValue({ user: { id: 'user-1', email: 'a@b.com' } })
    mockCheckoutCreate.mockResolvedValue({ url: 'https://checkout.stripe.com/pay/abc' })

    await createCheckoutSessionAction('price_123')

    expect(mockCheckoutCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        client_reference_id: 'user-1',
        customer_email: 'a@b.com',
        line_items: [{ price: 'price_123', quantity: 1 }],
        mode: 'subscription',
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
    mockGetUserStripeCustomerId.mockResolvedValue({ stripeCustomerId: null })
    const result = await createPortalSessionAction()
    expect(result.status).toBe('bad_request')
  })

  it('returns internal_error when portal session returns no URL', async () => {
    mockGetSession.mockResolvedValue({ user: { id: 'user-1' } })
    mockGetUserStripeCustomerId.mockResolvedValue({ stripeCustomerId: 'cus_abc' })
    mockPortalCreate.mockResolvedValue({ url: null })
    const result = await createPortalSessionAction()
    expect(result.status).toBe('internal_error')
  })

  it('returns internal_error when Stripe API throws', async () => {
    mockGetSession.mockResolvedValue({ user: { id: 'user-1' } })
    mockGetUserStripeCustomerId.mockResolvedValue({ stripeCustomerId: 'cus_abc' })
    mockPortalCreate.mockRejectedValue(new Error('Stripe network error'))
    const result = await createPortalSessionAction()
    expect(result.status).toBe('internal_error')
    expect(result.message).toContain('Unable to open billing portal')
  })

  it('creates portal session with correct customer ID and redirects on success', async () => {
    mockGetSession.mockResolvedValue({ user: { id: 'user-1' } })
    mockGetUserStripeCustomerId.mockResolvedValue({ stripeCustomerId: 'cus_abc' })
    mockPortalCreate.mockResolvedValue({ url: 'https://billing.stripe.com/session/abc' })

    await createPortalSessionAction()

    expect(mockPortalCreate).toHaveBeenCalledWith(
      expect.objectContaining({ customer: 'cus_abc' })
    )
    expect(mockRedirect).toHaveBeenCalledWith('https://billing.stripe.com/session/abc')
  })
})
