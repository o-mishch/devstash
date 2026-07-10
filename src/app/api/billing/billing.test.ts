import { vi, describe, it, expect, beforeEach } from 'vitest'
import { readJson } from '@/test/matchers'
import { NextRequest } from 'next/server'
import type Stripe from 'stripe'
import type { getCachedSession as GetCachedSessionFn } from '@/lib/session'
import type {
  getCachedVerifiedProAccess,
  resolveProAccessBypassingCache as ResolveProAccessBypassingCacheFn,
} from '@/lib/billing/access/pro-access-resolution'
import type { checkRateLimit as CheckRateLimitFn, deniedMessage } from '@/lib/infra/rate-limit'
import type {
  createCheckoutSession as CreateCheckoutSessionFn,
  createPortalSession as CreatePortalSessionFn,
  updateStripeCustomerEmail as UpdateStripeCustomerEmailFn,
} from '@/lib/infra/stripe'
import type {
  cancelIncompleteSubscriptionsForCustomer as CancelIncompleteSubscriptionsForCustomerFn,
  resolveOrCreateStripeCustomer as ResolveOrCreateStripeCustomerFn,
  validateCheckoutEligibility as ValidateCheckoutEligibilityFn,
} from '@/lib/billing/checkout/stripe-checkout'
import type {
  getCachedUserStripeInfo as GetCachedUserStripeInfoFn,
  loadBillingPageContext as LoadBillingPageContextFn,
  BillingPageContext,
} from '@/lib/billing/sync/user-billing-state'
import type { UserStripeInfo } from '@/lib/db/stripe'
import type { getUserUsageStats as GetUserUsageStatsFn } from '@/lib/db/usage'
import type { getExistingSubscriptionMessage } from '@/lib/billing/messages/billing-messages'
import type { reconcileOrphanStripeSubscriptionForUser } from '@/lib/billing/sync/passive-billing-sync'
import type {
  isAllowedCheckoutPriceId as IsAllowedCheckoutPriceIdFn,
  isStripeCheckoutConfigured as IsStripeCheckoutConfiguredFn,
} from '@/lib/billing/config/billing-pricing'
import type { toggleSubscriptionCancellation as ToggleSubscriptionCancellationFn } from '@/lib/billing/subscription/toggle-cancellation'

vi.mock('@/lib/session', () => ({ getCachedSession: vi.fn<typeof GetCachedSessionFn>() }))
vi.mock('@/lib/billing/access/pro-access-resolution', () => ({
  getCachedVerifiedProAccess: vi.fn<typeof getCachedVerifiedProAccess>(),
  resolveProAccessBypassingCache: vi.fn<typeof ResolveProAccessBypassingCacheFn>(),
}))
vi.mock('@/lib/infra/rate-limit', () => ({
  checkRateLimit: vi.fn<typeof CheckRateLimitFn>(),
  deniedMessage: vi.fn<typeof deniedMessage>((retryAfter: number) => `Too many attempts (${retryAfter}s).`),
}))
vi.mock('@/lib/infra/stripe', () => ({
  createCheckoutSession: vi.fn<typeof CreateCheckoutSessionFn>(),
  createPortalSession: vi.fn<typeof CreatePortalSessionFn>(),
  updateStripeCustomerEmail: vi.fn<typeof UpdateStripeCustomerEmailFn>(),
}))
vi.mock('@/lib/billing/checkout/stripe-checkout', () => ({
  cancelIncompleteSubscriptionsForCustomer: vi.fn<typeof CancelIncompleteSubscriptionsForCustomerFn>(),
  resolveOrCreateStripeCustomer: vi.fn<typeof ResolveOrCreateStripeCustomerFn>(),
  validateCheckoutEligibility: vi.fn<typeof ValidateCheckoutEligibilityFn>(),
}))
vi.mock('@/lib/billing/sync/user-billing-state', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/billing/sync/user-billing-state')>()
  return {
    getCachedUserStripeInfo: vi.fn<typeof GetCachedUserStripeInfoFn>(),
    loadBillingPageContext: vi.fn<typeof LoadBillingPageContextFn>(),
    // Use the real pure serializer so the route's wire contract (Date→ISO, dropped server-only config
    // fields, correct arg order) is exercised rather than a pass-through stub.
    toBillingContextResponse: actual.toBillingContextResponse,
  }
})
vi.mock('@/lib/db/usage', () => ({ getUserUsageStats: vi.fn<typeof GetUserUsageStatsFn>() }))
vi.mock('@/lib/billing/messages/billing-messages', () => ({ getExistingSubscriptionMessage: vi.fn<typeof getExistingSubscriptionMessage>(() => 'You already have a subscription.') }))
vi.mock('@/lib/billing/sync/passive-billing-sync', () => ({ reconcileOrphanStripeSubscriptionForUser: vi.fn<typeof reconcileOrphanStripeSubscriptionForUser>() }))
vi.mock('@/lib/billing/config/billing-pricing', () => ({
  isAllowedCheckoutPriceId: vi.fn<typeof IsAllowedCheckoutPriceIdFn>(),
  isStripeCheckoutConfigured: vi.fn<typeof IsStripeCheckoutConfiguredFn>(),
}))
vi.mock('@/lib/billing/subscription/toggle-cancellation', () => ({ toggleSubscriptionCancellation: vi.fn<typeof ToggleSubscriptionCancellationFn>() }))

import { getCachedSession } from '@/lib/session'
import { resolveProAccessBypassingCache } from '@/lib/billing/access/pro-access-resolution'
import { checkRateLimit } from '@/lib/infra/rate-limit'
import { createCheckoutSession, createPortalSession, updateStripeCustomerEmail } from '@/lib/infra/stripe'
import { validateCheckoutEligibility, cancelIncompleteSubscriptionsForCustomer, resolveOrCreateStripeCustomer } from '@/lib/billing/checkout/stripe-checkout'
import { getCachedUserStripeInfo, loadBillingPageContext } from '@/lib/billing/sync/user-billing-state'
import { getUserUsageStats } from '@/lib/db/usage'
import { isAllowedCheckoutPriceId, isStripeCheckoutConfigured } from '@/lib/billing/config/billing-pricing'
import { toggleSubscriptionCancellation } from '@/lib/billing/subscription/toggle-cancellation'

import { POST as CHECKOUT } from './checkout/route'
import { POST as PORTAL } from './portal/route'
import { POST as CANCEL } from './cancel/route'
import { POST as REACTIVATE } from './reactivate/route'
import { GET as CONTEXT } from './context/route'

const mockSession = vi.mocked(getCachedSession)
const mockResolvePro = vi.mocked(resolveProAccessBypassingCache)
const mockRateLimit = vi.mocked(checkRateLimit)
const mockCreateCheckout = vi.mocked(createCheckoutSession)
const mockCreatePortal = vi.mocked(createPortalSession)
const mockEligibility = vi.mocked(validateCheckoutEligibility)
const mockStripeInfo = vi.mocked(getCachedUserStripeInfo)
const mockAllowedPrice = vi.mocked(isAllowedCheckoutPriceId)
const mockConfigured = vi.mocked(isStripeCheckoutConfigured)
const mockToggle = vi.mocked(toggleSubscriptionCancellation)
const mockResolveOrCreateCustomer = vi.mocked(resolveOrCreateStripeCustomer)
const mockUpdateCustomerEmail = vi.mocked(updateStripeCustomerEmail)
const mockCancelIncomplete = vi.mocked(cancelIncompleteSubscriptionsForCustomer)
const mockLoadBillingPage = vi.mocked(loadBillingPageContext)
const mockUsageStats = vi.mocked(getUserUsageStats)

function post(path: string, payload?: unknown): NextRequest {
  return new NextRequest(`http://localhost/api/billing/${path}`, {
    method: 'POST',
    body: payload === undefined ? undefined : JSON.stringify(payload),
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  mockSession.mockResolvedValue({ user: { id: 'user-1', email: 'me@example.com', isPro: false }, expires: '2099-01-01T00:00:00.000Z' })
  mockRateLimit.mockResolvedValue({ success: true, retryAfter: 0 })
  mockResolvePro.mockResolvedValue(false)
  mockAllowedPrice.mockReturnValue(true)
  mockConfigured.mockReturnValue(true)
  mockEligibility.mockResolvedValue({ status: 'ok', customerId: undefined })
  mockStripeInfo.mockResolvedValue(null)
  mockResolveOrCreateCustomer.mockResolvedValue({ status: 'ok', customerId: 'cus_resolved' })
  mockUpdateCustomerEmail.mockResolvedValue(undefined)
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
    mockCreateCheckout.mockResolvedValue({ url: 'https://stripe/checkout', id: 'cs_1' } as Stripe.Checkout.Session)
    const res = await CHECKOUT(post('checkout', { priceId: 'price_1' }))
    expect(res.status).toBe(200)
    expect((await readJson(res)).url).toBe('https://stripe/checkout')
  })

  it('returns 500 when Stripe session creation throws', async () => {
    mockCreateCheckout.mockRejectedValue(new Error('stripe down'))
    const res = await CHECKOUT(post('checkout', { priceId: 'price_1' }))
    expect(res.status).toBe(500)
  })

  it('returns 500 when the session has no email to resolve a customer', async () => {
    mockSession.mockResolvedValue({ user: { id: 'user-1', email: null, isPro: false }, expires: '2099-01-01T00:00:00.000Z' })
    const res = await CHECKOUT(post('checkout', { priceId: 'price_1' }))
    expect(res.status).toBe(500)
    expect(mockResolveOrCreateCustomer).not.toHaveBeenCalled()
    expect(mockCreateCheckout).not.toHaveBeenCalled()
  })

  it('returns 409 when the resolved Stripe customer belongs to another user', async () => {
    mockResolveOrCreateCustomer.mockResolvedValue({ status: 'foreign' })
    const res = await CHECKOUT(post('checkout', { priceId: 'price_1' }))
    expect(res.status).toBe(409)
    expect(mockCreateCheckout).not.toHaveBeenCalled()
  })

  it('passes the resolved/created customer id through to the Stripe session', async () => {
    mockResolveOrCreateCustomer.mockResolvedValue({ status: 'ok', customerId: 'cus_new' })
    mockCreateCheckout.mockResolvedValue({ url: 'https://stripe/checkout', id: 'cs_2' } as Stripe.Checkout.Session)
    const res = await CHECKOUT(post('checkout', { priceId: 'price_1' }))
    expect(res.status).toBe(200)
    expect(mockResolveOrCreateCustomer).toHaveBeenCalledWith(
      expect.objectContaining({ userId: 'user-1', email: 'me@example.com' }),
    )
    expect(mockCreateCheckout).toHaveBeenCalledWith(expect.objectContaining({ customerId: 'cus_new' }))
  })

  it('refreshes the Stripe customer email and cancels incomplete subs for the resolved customer', async () => {
    mockResolveOrCreateCustomer.mockResolvedValue({ status: 'ok', customerId: 'cus_linked' })
    mockCreateCheckout.mockResolvedValue({ url: 'https://stripe/checkout', id: 'cs_3' } as Stripe.Checkout.Session)
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
    mockStripeInfo.mockResolvedValue({
      email: 'user@example.com',
      stripeCustomerId: 'cus_1',
      stripeSubscriptionId: null,
      stripeSubscriptionStatus: null,
      isPro: false,
      stripeSubscriptionStart: null,
      stripeCurrentPeriodEnd: null,
      stripeSubscriptionInterval: null,
      stripeCancelAtPeriodEnd: false,
      stripeLastSyncAt: null,
      proExpiredAt: null,
    } satisfies UserStripeInfo)
    mockCreatePortal.mockResolvedValue({ url: 'https://stripe/portal' } as Stripe.BillingPortal.Session)
    const res = await PORTAL(post('portal'))
    expect(res.status).toBe(200)
    expect((await readJson(res)).url).toBe('https://stripe/portal')
  })
})

describe('GET /billing/context', () => {
  const billingPage = {
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
    // Server-only config fields the wire shape must drop.
    checkoutConfigured: true,
    priceIdMonthly: 'price_m',
    priceIdYearly: 'price_y',
  } satisfies BillingPageContext

  it('returns 401 when not signed in', async () => {
    mockSession.mockResolvedValue(null)
    const res = await CONTEXT(new NextRequest('http://localhost/api/billing/context'))
    expect(res.status).toBe(401)
  })

  it('returns 200 with the serialized billing context + usage, scoped to the session userId', async () => {
    mockLoadBillingPage.mockResolvedValue(billingPage)
    mockUsageStats.mockResolvedValue({ itemsCount: 2, collectionsCount: 1 })
    const res = await CONTEXT(new NextRequest('http://localhost/api/billing/context'))
    expect(res.status).toBe(200)
    expect(mockLoadBillingPage.mock.calls[0][0]).toBe('user-1')
    expect(mockUsageStats).toHaveBeenCalledWith('user-1')
    const body = await readJson<{ billing: { stripeSubscriptionStart: string; stripeCurrentPeriodEnd: string } }>(res)
    expect(body).toMatchObject({ isPro: true, usage: { itemsCount: 2, collectionsCount: 1 } })
    // Real serializer: Date → ISO string, server-only config fields stripped.
    expect(body.billing.stripeSubscriptionStart).toBe('2026-06-01T00:00:00.000Z')
    expect(body.billing.stripeCurrentPeriodEnd).toBe('2026-07-01T00:00:00.000Z')
    expect('checkoutConfigured' in body).toBe(false)
    expect('priceIdMonthly' in body).toBe(false)
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
