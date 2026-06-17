import { vi, describe, it, expect, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('@/lib/session', () => ({ getCachedSession: vi.fn() }))
vi.mock('@/lib/billing/access/pro-access-resolution', () => ({
  getCachedVerifiedProAccess: vi.fn(),
  resolveProAccessBypassingCache: vi.fn(),
}))
vi.mock('@/lib/infra/rate-limit', () => ({
  checkRateLimit: vi.fn(),
  deniedMessage: vi.fn((retryAfter: number) => `Too many attempts (${retryAfter}s).`),
}))
vi.mock('@/lib/infra/stripe', () => ({
  createCheckoutSession: vi.fn(),
  createPortalSession: vi.fn(),
  ensureStripeCustomerUserId: vi.fn(),
  updateStripeCustomerEmail: vi.fn(),
}))
vi.mock('@/lib/billing/checkout/stripe-checkout', () => ({
  cancelIncompleteSubscriptionsForCustomer: vi.fn(),
  validateCheckoutEligibility: vi.fn(),
}))
vi.mock('@/lib/billing/sync/user-billing-state', () => ({ getCachedUserStripeInfo: vi.fn() }))
vi.mock('@/lib/billing/messages/billing-messages', () => ({ getExistingSubscriptionMessage: vi.fn(() => 'You already have a subscription.') }))
vi.mock('@/lib/billing/sync/passive-billing-sync', () => ({ reconcileOrphanStripeSubscriptionForUser: vi.fn() }))
vi.mock('@/lib/billing/config/billing-pricing', () => ({
  isAllowedCheckoutPriceId: vi.fn(),
  isStripeCheckoutConfigured: vi.fn(),
}))
vi.mock('@/lib/billing/subscription/toggle-cancellation', () => ({ toggleSubscriptionCancellation: vi.fn() }))

import { getCachedSession } from '@/lib/session'
import { resolveProAccessBypassingCache } from '@/lib/billing/access/pro-access-resolution'
import { checkRateLimit } from '@/lib/infra/rate-limit'
import { createCheckoutSession, createPortalSession, ensureStripeCustomerUserId, updateStripeCustomerEmail } from '@/lib/infra/stripe'
import { validateCheckoutEligibility, cancelIncompleteSubscriptionsForCustomer } from '@/lib/billing/checkout/stripe-checkout'
import { getCachedUserStripeInfo } from '@/lib/billing/sync/user-billing-state'
import { isAllowedCheckoutPriceId, isStripeCheckoutConfigured } from '@/lib/billing/config/billing-pricing'
import { toggleSubscriptionCancellation } from '@/lib/billing/subscription/toggle-cancellation'

import { POST as CHECKOUT } from './checkout/route'
import { POST as PORTAL } from './portal/route'
import { POST as CANCEL } from './cancel/route'
import { POST as REACTIVATE } from './reactivate/route'

const mockSession = getCachedSession as ReturnType<typeof vi.fn>
const mockResolvePro = resolveProAccessBypassingCache as ReturnType<typeof vi.fn>
const mockRateLimit = checkRateLimit as ReturnType<typeof vi.fn>
const mockCreateCheckout = createCheckoutSession as ReturnType<typeof vi.fn>
const mockCreatePortal = createPortalSession as ReturnType<typeof vi.fn>
const mockEligibility = validateCheckoutEligibility as ReturnType<typeof vi.fn>
const mockStripeInfo = getCachedUserStripeInfo as ReturnType<typeof vi.fn>
const mockAllowedPrice = isAllowedCheckoutPriceId as ReturnType<typeof vi.fn>
const mockConfigured = isStripeCheckoutConfigured as ReturnType<typeof vi.fn>
const mockToggle = toggleSubscriptionCancellation as ReturnType<typeof vi.fn>
const mockEnsureCustomer = ensureStripeCustomerUserId as ReturnType<typeof vi.fn>
const mockUpdateCustomerEmail = updateStripeCustomerEmail as ReturnType<typeof vi.fn>
const mockCancelIncomplete = cancelIncompleteSubscriptionsForCustomer as ReturnType<typeof vi.fn>

function post(path: string, payload?: unknown): NextRequest {
  return new NextRequest(`http://localhost/api/billing/${path}`, {
    method: 'POST',
    body: payload === undefined ? undefined : JSON.stringify(payload),
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  mockSession.mockResolvedValue({ user: { id: 'user-1', email: 'me@example.com' } })
  mockRateLimit.mockResolvedValue({ success: true, retryAfter: 0 })
  mockResolvePro.mockResolvedValue(false)
  mockAllowedPrice.mockReturnValue(true)
  mockConfigured.mockReturnValue(true)
  mockEligibility.mockResolvedValue({ status: 'ok', customerId: undefined })
  mockStripeInfo.mockResolvedValue(null)
})

describe('POST /billing/checkout', () => {
  it('returns 401 when not signed in', async () => {
    mockSession.mockResolvedValue(null)
    const res = await CHECKOUT(post('checkout', { priceId: 'price_1' }))
    expect(res.status).toBe(401)
  })

  it('returns 422 for a missing priceId', async () => {
    const res = await CHECKOUT(post('checkout', {}))
    expect(res.status).toBe(422)
  })

  it('returns 400 for a disallowed price id', async () => {
    mockAllowedPrice.mockReturnValue(false)
    const res = await CHECKOUT(post('checkout', { priceId: 'price_bad' }))
    expect(res.status).toBe(400)
  })

  it('returns 409 when the user already has an active subscription', async () => {
    mockResolvePro.mockResolvedValue(true)
    const res = await CHECKOUT(post('checkout', { priceId: 'price_1' }))
    expect(res.status).toBe(409)
  })

  it('returns 200 with the Stripe checkout URL', async () => {
    mockCreateCheckout.mockResolvedValue({ url: 'https://stripe/checkout', id: 'cs_1' })
    const res = await CHECKOUT(post('checkout', { priceId: 'price_1' }))
    expect(res.status).toBe(200)
    expect((await res.json()).url).toBe('https://stripe/checkout')
  })

  it('returns 500 when Stripe session creation throws', async () => {
    mockCreateCheckout.mockRejectedValue(new Error('stripe down'))
    const res = await CHECKOUT(post('checkout', { priceId: 'price_1' }))
    expect(res.status).toBe(500)
  })

  it('returns 409 when the stored Stripe customer belongs to another user', async () => {
    mockStripeInfo.mockResolvedValue({ stripeCustomerId: 'cus_foreign' })
    mockEnsureCustomer.mockResolvedValue('foreign')
    const res = await CHECKOUT(post('checkout', { priceId: 'price_1' }))
    expect(res.status).toBe(409)
    expect(mockCreateCheckout).not.toHaveBeenCalled()
  })

  it('drops a deleted Stripe customer and recreates checkout from the email', async () => {
    mockStripeInfo.mockResolvedValue({ stripeCustomerId: 'cus_dead' })
    mockEnsureCustomer.mockResolvedValue('deleted')
    mockCreateCheckout.mockResolvedValue({ url: 'https://stripe/checkout', id: 'cs_2' })
    const res = await CHECKOUT(post('checkout', { priceId: 'price_1' }))
    expect(res.status).toBe(200)
    // Falls back to customer_email: the dead customerId is not passed through.
    expect(mockCreateCheckout).toHaveBeenCalledWith(expect.objectContaining({ customerId: undefined }))
    expect(mockCancelIncomplete).not.toHaveBeenCalled()
  })

  it('refreshes the Stripe customer email when reusing a linked customer', async () => {
    mockStripeInfo.mockResolvedValue({ stripeCustomerId: 'cus_linked' })
    mockEnsureCustomer.mockResolvedValue('linked')
    mockUpdateCustomerEmail.mockResolvedValue(undefined)
    mockCreateCheckout.mockResolvedValue({ url: 'https://stripe/checkout', id: 'cs_3' })
    const res = await CHECKOUT(post('checkout', { priceId: 'price_1' }))
    expect(res.status).toBe(200)
    expect(mockUpdateCustomerEmail).toHaveBeenCalledWith('cus_linked', 'me@example.com')
    expect(mockCancelIncomplete).toHaveBeenCalledWith('cus_linked')
  })
})

describe('POST /billing/portal', () => {
  it('returns 400 when the user has no Stripe customer', async () => {
    mockStripeInfo.mockResolvedValue(null)
    const res = await PORTAL(post('portal'))
    expect(res.status).toBe(400)
  })

  it('returns 200 with the Stripe portal URL', async () => {
    mockStripeInfo.mockResolvedValue({ stripeCustomerId: 'cus_1' })
    mockCreatePortal.mockResolvedValue({ url: 'https://stripe/portal' })
    const res = await PORTAL(post('portal'))
    expect(res.status).toBe(200)
    expect((await res.json()).url).toBe('https://stripe/portal')
  })
})

describe('POST /billing/cancel', () => {
  it('returns 204 and schedules cancellation for the session user', async () => {
    const res = await CANCEL(post('cancel'))
    expect(res.status).toBe(204)
    expect(mockToggle).toHaveBeenCalledWith('user-1', true)
  })
})

describe('POST /billing/reactivate', () => {
  it('returns 204 and reactivates for the session user', async () => {
    const res = await REACTIVATE(post('reactivate'))
    expect(res.status).toBe(204)
    expect(mockToggle).toHaveBeenCalledWith('user-1', false)
  })
})
