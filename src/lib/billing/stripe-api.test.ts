import { beforeEach, describe, expect, it, vi } from 'vitest'
import Stripe from 'stripe'

const { mockSubscriptionsRetrieve, mockCheckoutSessionsRetrieve } = vi.hoisted(() => ({
  mockSubscriptionsRetrieve: vi.fn(),
  mockCheckoutSessionsRetrieve: vi.fn(),
}))

vi.mock('@/lib/stripe', () => ({
  stripe: {
    subscriptions: { retrieve: mockSubscriptionsRetrieve },
    checkout: { sessions: { retrieve: mockCheckoutSessionsRetrieve } },
  },
}))

vi.mock('@/lib/infra/logger', () => ({
  createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() }),
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
    })

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
    mockCheckoutSessionsRetrieve.mockResolvedValue({
      customer: 'cus_123',
      payment_status: 'paid',
      client_reference_id: 'user-1',
      subscription: {
        id: 'sub_123',
        metadata: { userId: 'user-1' },
      },
    })

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
