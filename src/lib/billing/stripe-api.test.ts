import { beforeEach, describe, expect, it, vi } from 'vitest'
import Stripe from 'stripe'
import type { Logger } from 'pino'

// Mirrors the real `stripe.subscriptions.retrieve` / `stripe.checkout.sessions.retrieve`
// call signatures, minus the SDK's `Response<T>` wire-envelope (the `lastResponse` field) —
// nothing in this file or in `stripe-api.ts` reads it, so fixtures stay plain `Stripe.Subscription` /
// `Stripe.Checkout.Session` objects instead of fabricating a meaningless envelope.
type SubscriptionsRetrieve = (
  id: string,
  params?: Stripe.SubscriptionRetrieveParams,
  options?: Stripe.RequestOptions,
) => Promise<Stripe.Subscription>

type CheckoutSessionsRetrieve = (
  id: string,
  params?: Stripe.Checkout.SessionRetrieveParams,
  options?: Stripe.RequestOptions,
) => Promise<Stripe.Checkout.Session>

const { mockSubscriptionsRetrieve, mockCheckoutSessionsRetrieve } = vi.hoisted(() => ({
  mockSubscriptionsRetrieve: vi.fn<SubscriptionsRetrieve>(),
  mockCheckoutSessionsRetrieve: vi.fn<CheckoutSessionsRetrieve>(),
}))

vi.mock('@/lib/infra/stripe', () => ({
  stripe: {
    subscriptions: { retrieve: mockSubscriptionsRetrieve },
    checkout: { sessions: { retrieve: mockCheckoutSessionsRetrieve } },
  },
}))

vi.mock('@/lib/infra/pino', () => ({
  logger: {
    child: () => ({
      info: vi.fn<Logger['info']>(),
      warn: vi.fn<Logger['warn']>(),
      error: vi.fn<Logger['error']>(),
    }),
  },
}))

import {
  fetchCheckoutSessionDetails,
  fetchLiveSubscriptionState,
  fetchSubscriptionDetails,
} from './stripe-api'

describe('fetchLiveSubscriptionState', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    process.env.STRIPE_PRICE_ID_MONTHLY = 'price_monthly'
    process.env.STRIPE_PRICE_ID_YEARLY = 'price_yearly'
  })

  it('returns exists:false when subscription is missing in Stripe', async () => {
    mockSubscriptionsRetrieve.mockRejectedValue(
      new Stripe.errors.StripeInvalidRequestError({
        type: 'invalid_request_error',
        message: 'No such subscription',
        code: 'resource_missing',
      }),
    )

    const result = await fetchLiveSubscriptionState('sub_missing')

    expect(result).toEqual({
      exists: false,
      cancelAtPeriodEnd: false,
      currentPeriodEnd: null,
      interval: null,
      status: null,
    })
  })

  it('returns null on transient Stripe errors', async () => {
    mockSubscriptionsRetrieve.mockRejectedValue(new Error('network down'))

    await expect(fetchLiveSubscriptionState('sub_123')).resolves.toBeNull()
  })

  it('maps an active subscription to live state', async () => {
    mockSubscriptionsRetrieve.mockResolvedValue({
      id: 'sub_123',
      status: 'active',
      cancel_at_period_end: false,
      items: {
        data: [{ id: 'si_1', current_period_end: 1_700_000_000, price: { id: 'price_monthly', recurring: { interval: 'month' } } }],
      },
    } as Stripe.Subscription)

    const result = await fetchLiveSubscriptionState('sub_123')

    expect(result?.exists).toBe(true)
    expect(result?.status).toBe('active')
    expect(result?.interval).toBe('month')
  })
})

describe('fetchSubscriptionDetails', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    process.env.STRIPE_PRICE_ID_MONTHLY = 'price_monthly'
    process.env.STRIPE_PRICE_ID_YEARLY = 'price_yearly'
  })

  it('returns null when subscription is missing', async () => {
    mockSubscriptionsRetrieve.mockRejectedValue(
      new Stripe.errors.StripeInvalidRequestError({
        type: 'invalid_request_error',
        message: 'No such subscription',
        code: 'resource_missing',
      }),
    )

    await expect(fetchSubscriptionDetails('sub_missing')).resolves.toBeNull()
  })
})

describe('fetchCheckoutSessionDetails', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns session ownership and subscription fields', async () => {
    const subscriptionMetadata: Stripe.Metadata = { userId: 'user-1' }
    mockCheckoutSessionsRetrieve.mockResolvedValue({
      customer: 'cus_123',
      payment_status: 'paid',
      client_reference_id: 'user-1',
      subscription: {
        id: 'sub_123',
        metadata: subscriptionMetadata,
      } as Stripe.Subscription,
    } as Stripe.Checkout.Session)

    const result = await fetchCheckoutSessionDetails('cs_123')

    expect(result).toEqual({
      customerId: 'cus_123',
      paymentStatus: 'paid',
      subscriptionId: 'sub_123',
      userId: 'user-1',
    })
  })

  it('returns null when Stripe session retrieval fails', async () => {
    mockCheckoutSessionsRetrieve.mockRejectedValue(new Error('Stripe unavailable'))

    await expect(fetchCheckoutSessionDetails('cs_123')).resolves.toBeNull()
  })
})

describe('getPrimarySubscriptionItem', () => {
  it('prefers configured plan price IDs over other recurring items', async () => {
    const { getPrimarySubscriptionItem } = await import('./stripe-api')
    process.env.STRIPE_PRICE_ID_MONTHLY = 'price_monthly'
    process.env.STRIPE_PRICE_ID_YEARLY = 'price_yearly'

    const subscription = {
      items: {
        data: [
          { id: 'si_addon', price: { id: 'price_addon', recurring: { interval: 'month' } } },
          { id: 'si_plan', price: { id: 'price_monthly', recurring: { interval: 'month' } } },
        ],
      },
    } as Stripe.Subscription

    expect(getPrimarySubscriptionItem(subscription)?.id).toBe('si_plan')
  })
})
