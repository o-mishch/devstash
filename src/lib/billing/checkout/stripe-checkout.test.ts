import { beforeEach, describe, expect, it, vi } from 'vitest'
import type Stripe from 'stripe'

const {
  mockFetchCheckoutSessionDetails,
  mockIsAllowedCheckoutPriceId,
  mockPersistSubscriptionFromStripe,
  mockGetCachedUserStripeInfo,
  mockCustomersList,
  mockIterateCustomerSubscriptions,
} = vi.hoisted(() => ({
  mockFetchCheckoutSessionDetails: vi.fn(),
  mockIsAllowedCheckoutPriceId: vi.fn(),
  mockPersistSubscriptionFromStripe: vi.fn(),
  mockGetCachedUserStripeInfo: vi.fn(),
  mockCustomersList: vi.fn(),
  mockIterateCustomerSubscriptions: vi.fn(),
}))

vi.mock('@/lib/billing/stripe-api', () => ({
  fetchCheckoutSessionDetails: mockFetchCheckoutSessionDetails,
  listStripeCustomersByEmail: mockCustomersList,
  iterateCustomerSubscriptions: mockIterateCustomerSubscriptions,
}))

vi.mock('@/lib/billing/config/billing-pricing', () => ({
  isAllowedCheckoutPriceId: mockIsAllowedCheckoutPriceId,
}))

vi.mock('@/lib/billing/subscription/stripe-subscription-persist', () => ({
  persistSubscriptionFromStripe: mockPersistSubscriptionFromStripe,
}))

vi.mock('@/lib/billing/sync/user-billing-state', () => ({
  getCachedUserStripeInfo: mockGetCachedUserStripeInfo,
}))

vi.mock('@/lib/infra/pino', () => ({
  logger: { child: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() }) },
}))

import {
  finalizeCheckoutSessionForUser,
  findCheckoutBlockingSubscription,
  findCheckoutCustomerByEmail,
  resolveStripeCustomerForUser,
  validateCheckoutEligibility,
} from './stripe-checkout'

function makeSubscription(overrides: Partial<Stripe.Subscription> = {}): Stripe.Subscription {
  return {
    id: 'sub_123',
    status: 'active',
    metadata: { userId: 'user-1' },
    ...overrides,
  } as Stripe.Subscription
}

async function* subscriptionIterator(subscriptions: Stripe.Subscription[]) {
  await Promise.resolve()
  for (const subscription of subscriptions) {
    yield subscription
  }
}

describe('findCheckoutBlockingSubscription', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns the first subscription that blocks new checkout', async () => {
    mockIterateCustomerSubscriptions.mockReturnValue(
      subscriptionIterator([
        makeSubscription({ id: 'sub_canceled', status: 'canceled' }),
        makeSubscription({ id: 'sub_active', status: 'active' }),
      ]),
    )

    const result = await findCheckoutBlockingSubscription('cus_1')

    expect(result?.id).toBe('sub_active')
  })

  it('returns null when no subscriptions block checkout', async () => {
    mockIterateCustomerSubscriptions.mockReturnValue(
      subscriptionIterator([makeSubscription({ status: 'canceled' })]),
    )

    expect(await findCheckoutBlockingSubscription('cus_1')).toBeNull()
  })
})

describe('resolveStripeCustomerForUser', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('uses the linked stripeCustomerId when present', async () => {
    mockIterateCustomerSubscriptions.mockReturnValue(subscriptionIterator([]))

    const result = await resolveStripeCustomerForUser({
      userId: 'user-1',
      email: 'user@example.com',
      stripeCustomerId: 'cus_linked',
    })

    expect(result).toEqual({ customerId: 'cus_linked', blockingSubscription: null })
    expect(mockIterateCustomerSubscriptions).toHaveBeenCalledWith('cus_linked')
  })
})

describe('findCheckoutCustomerByEmail', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('prefers the customer matching preferredCustomerId when ranking', async () => {
    mockCustomersList.mockResolvedValue([
      { id: 'cus_other', email: 'user@example.com', deleted: false },
      {
        id: 'cus_preferred',
        email: 'user@example.com',
        deleted: false,
        metadata: { userId: 'user-1' },
      },
    ])
    mockIterateCustomerSubscriptions.mockReturnValue(subscriptionIterator([]))

    const result = await findCheckoutCustomerByEmail('user@example.com', {
      preferredCustomerId: 'cus_preferred',
      userId: 'user-1',
    })

    expect(result.customerId).toBe('cus_preferred')
  })

  it('skips blocking subscriptions owned by another user', async () => {
    mockCustomersList.mockResolvedValue([
      { id: 'cus_1', email: 'user@example.com', deleted: false },
    ])
    mockIterateCustomerSubscriptions.mockReturnValue(
      subscriptionIterator([makeSubscription({ metadata: { userId: 'other-user' } })]),
    )

    const result = await findCheckoutCustomerByEmail('user@example.com', { userId: 'user-1' })

    expect(result).toEqual({ blockingSubscription: null, customerId: null })
  })

  it('returns blocking subscription when metadata matches user', async () => {
    const blocking = makeSubscription({ metadata: { userId: 'user-1' } })
    mockCustomersList.mockResolvedValue([
      {
        id: 'cus_1',
        email: 'user@example.com',
        deleted: false,
        metadata: { userId: 'user-1' },
      },
    ])
    mockIterateCustomerSubscriptions.mockReturnValue(subscriptionIterator([blocking]))

    const result = await findCheckoutCustomerByEmail('user@example.com', { userId: 'user-1' })

    expect(result).toEqual({ blockingSubscription: blocking, customerId: 'cus_1' })
  })
})

describe('validateCheckoutEligibility', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockIsAllowedCheckoutPriceId.mockReturnValue(true)
  })

  it('returns invalid_price when price ID is not allowed', async () => {
    mockIsAllowedCheckoutPriceId.mockReturnValue(false)

    const result = await validateCheckoutEligibility('user-1', 'price_invalid')

    expect(result).toEqual({ status: 'invalid_price' })
    expect(mockGetCachedUserStripeInfo).not.toHaveBeenCalled()
  })

  it('returns ok when user has no blocking subscription', async () => {
    mockGetCachedUserStripeInfo.mockResolvedValue({
      email: 'user@example.com',
      stripeCustomerId: 'cus_1',
    })
    mockIterateCustomerSubscriptions.mockReturnValue(subscriptionIterator([]))

    const result = await validateCheckoutEligibility('user-1', 'price_monthly')

    expect(result).toEqual({ status: 'ok', customerId: 'cus_1' })
  })

  it('returns existing_subscription when customer already has an active sub', async () => {
    const blockingSubscription = makeSubscription()
    mockGetCachedUserStripeInfo.mockResolvedValue({
      email: 'user@example.com',
      stripeCustomerId: 'cus_1',
    })
    mockIterateCustomerSubscriptions.mockReturnValue(subscriptionIterator([blockingSubscription]))

    const result = await validateCheckoutEligibility('user-1', 'price_monthly')

    expect(result.status).toBe('existing_subscription')
    expect(result.subscriptionId).toBe('sub_123')
    expect(result.blockingSubscription).toBe(blockingSubscription)
  })

  it('returns error when Stripe lookup throws', async () => {
    mockGetCachedUserStripeInfo.mockResolvedValue({ email: 'user@example.com' })
    mockIterateCustomerSubscriptions.mockImplementation(() => {
      throw new Error('Stripe unavailable')
    })

    const result = await validateCheckoutEligibility('user-1', 'price_monthly')

    expect(result).toEqual({ status: 'error' })
  })
})

describe('finalizeCheckoutSessionForUser', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns unavailable when Stripe fetch fails', async () => {
    mockFetchCheckoutSessionDetails.mockResolvedValue(null)

    const result = await finalizeCheckoutSessionForUser('user-1', 'cs_123')

    expect(result).toEqual({ status: 'unavailable' })
    expect(mockPersistSubscriptionFromStripe).not.toHaveBeenCalled()
  })

  it('returns invalid_session when checkout session has no subscription', async () => {
    mockFetchCheckoutSessionDetails.mockResolvedValue({
      subscriptionId: null,
      userId: 'user-1',
      customerId: 'cus_1',
      paymentStatus: 'paid',
    })

    const result = await finalizeCheckoutSessionForUser('user-1', 'cs_123')

    expect(result).toEqual({ status: 'invalid_session' })
    expect(mockPersistSubscriptionFromStripe).not.toHaveBeenCalled()
  })

  it('returns forbidden when session belongs to another user', async () => {
    mockFetchCheckoutSessionDetails.mockResolvedValue({
      subscriptionId: 'sub_123',
      userId: 'other-user',
      customerId: 'cus_1',
      paymentStatus: 'paid',
    })

    const result = await finalizeCheckoutSessionForUser('user-1', 'cs_123')

    expect(result).toEqual({ status: 'forbidden' })
    expect(mockPersistSubscriptionFromStripe).not.toHaveBeenCalled()
  })

  it('returns ok with grantsAccess when subscription is persisted and Pro is granted', async () => {
    mockFetchCheckoutSessionDetails.mockResolvedValue({
      subscriptionId: 'sub_123',
      userId: 'user-1',
      customerId: 'cus_1',
      paymentStatus: 'paid',
    })
    mockPersistSubscriptionFromStripe.mockResolvedValue({
      persisted: true,
      grantsAccess: true,
      outcome: 'updated',
    })

    const result = await finalizeCheckoutSessionForUser('user-1', 'cs_123')

    expect(result).toEqual({ status: 'ok', grantsAccess: true })
    expect(mockPersistSubscriptionFromStripe).toHaveBeenCalledWith(
      'user-1',
      'sub_123',
      'cus_1',
      false,
      'paid',
    )
  })

  it('returns ok with grantsAccess false when checkout is linked but unpaid', async () => {
    mockFetchCheckoutSessionDetails.mockResolvedValue({
      subscriptionId: 'sub_123',
      userId: 'user-1',
      customerId: 'cus_1',
      paymentStatus: 'unpaid',
    })
    mockPersistSubscriptionFromStripe.mockResolvedValue({
      persisted: true,
      grantsAccess: false,
      outcome: 'revoked',
    })

    const result = await finalizeCheckoutSessionForUser('user-1', 'cs_123')

    expect(result).toEqual({ status: 'ok', grantsAccess: false })
  })

  it('returns unavailable when persist fails', async () => {
    mockFetchCheckoutSessionDetails.mockResolvedValue({
      subscriptionId: 'sub_123',
      userId: 'user-1',
      customerId: 'cus_1',
      paymentStatus: 'paid',
    })
    mockPersistSubscriptionFromStripe.mockResolvedValue({
      persisted: false,
      grantsAccess: false,
      outcome: null,
    })

    const result = await finalizeCheckoutSessionForUser('user-1', 'cs_123')

    expect(result).toEqual({ status: 'unavailable' })
  })
})
