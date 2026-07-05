import { beforeEach, describe, expect, it, vi } from 'vitest'
import type Stripe from 'stripe'
import { Prisma } from '@/generated/prisma'

const {
  mockFetchCheckoutSessionDetails,
  mockIsAllowedCheckoutPriceId,
  mockPersistSubscriptionFromStripe,
  mockGetCachedUserStripeInfo,
  mockCustomersList,
  mockIterateCustomerSubscriptions,
  mockCancelAbandonedSubscription,
  mockIsStripeResourceMissing,
  mockCreateStripeCustomer,
  mockEnsureStripeCustomerUserId,
  mockClearStripeCustomerByCustomerId,
  mockLinkStripeCustomerToUser,
  mockInvalidateBillingCache,
} = vi.hoisted(() => ({
  mockFetchCheckoutSessionDetails: vi.fn(),
  mockIsAllowedCheckoutPriceId: vi.fn(),
  mockPersistSubscriptionFromStripe: vi.fn(),
  mockGetCachedUserStripeInfo: vi.fn(),
  mockCustomersList: vi.fn(),
  mockIterateCustomerSubscriptions: vi.fn(),
  mockCancelAbandonedSubscription: vi.fn(),
  mockIsStripeResourceMissing: vi.fn(),
  mockCreateStripeCustomer: vi.fn(),
  mockEnsureStripeCustomerUserId: vi.fn(),
  mockClearStripeCustomerByCustomerId: vi.fn(),
  mockLinkStripeCustomerToUser: vi.fn(),
  mockInvalidateBillingCache: vi.fn(),
}))

vi.mock('@/lib/billing/stripe-api', () => ({
  fetchCheckoutSessionDetails: mockFetchCheckoutSessionDetails,
  listStripeCustomersByEmail: mockCustomersList,
  iterateCustomerSubscriptions: mockIterateCustomerSubscriptions,
  isStripeResourceMissing: mockIsStripeResourceMissing,
}))

vi.mock('@/lib/infra/stripe', () => ({
  cancelAbandonedSubscription: mockCancelAbandonedSubscription,
  createStripeCustomer: mockCreateStripeCustomer,
  ensureStripeCustomerUserId: mockEnsureStripeCustomerUserId,
}))

vi.mock('@/lib/db/stripe', () => ({
  clearStripeCustomerByCustomerId: mockClearStripeCustomerByCustomerId,
  linkStripeCustomerToUser: mockLinkStripeCustomerToUser,
}))

vi.mock('@/lib/infra/cache', () => ({
  invalidateBillingCache: mockInvalidateBillingCache,
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
  cancelIncompleteSubscriptionsForCustomer,
  finalizeCheckoutSessionForUser,
  findCheckoutBlockingSubscription,
  findCheckoutCustomerByEmail,
  resolveOrCreateStripeCustomer,
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

describe('cancelIncompleteSubscriptionsForCustomer', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockCancelAbandonedSubscription.mockResolvedValue(undefined)
  })

  it('cancels only incomplete subscriptions, skipping other statuses', async () => {
    mockIterateCustomerSubscriptions.mockReturnValue(
      subscriptionIterator([
        makeSubscription({ id: 'sub_incomplete', status: 'incomplete' }),
        makeSubscription({ id: 'sub_active', status: 'active' }),
        makeSubscription({ id: 'sub_canceled', status: 'canceled' }),
      ]),
    )

    await cancelIncompleteSubscriptionsForCustomer('cus_1')

    expect(mockCancelAbandonedSubscription).toHaveBeenCalledTimes(1)
    expect(mockCancelAbandonedSubscription).toHaveBeenCalledWith('sub_incomplete')
  })

  it('is a no-op when there are no incomplete subscriptions', async () => {
    mockIterateCustomerSubscriptions.mockReturnValue(
      subscriptionIterator([makeSubscription({ status: 'active' })]),
    )

    await cancelIncompleteSubscriptionsForCustomer('cus_1')

    expect(mockCancelAbandonedSubscription).not.toHaveBeenCalled()
  })

  it('cancels every incomplete subscription even when one cancel fails', async () => {
    mockIterateCustomerSubscriptions.mockReturnValue(
      subscriptionIterator([
        makeSubscription({ id: 'sub_a', status: 'incomplete' }),
        makeSubscription({ id: 'sub_b', status: 'incomplete' }),
        makeSubscription({ id: 'sub_c', status: 'incomplete' }),
      ]),
    )
    mockCancelAbandonedSubscription.mockImplementation((id: string) =>
      id === 'sub_b' ? Promise.reject(new Error('Stripe unavailable')) : Promise.resolve(),
    )

    await expect(cancelIncompleteSubscriptionsForCustomer('cus_1')).resolves.toBeUndefined()

    expect(mockCancelAbandonedSubscription).toHaveBeenCalledTimes(3)
    expect(mockCancelAbandonedSubscription).toHaveBeenCalledWith('sub_a')
    expect(mockCancelAbandonedSubscription).toHaveBeenCalledWith('sub_c')
  })
})

describe('resolveStripeCustomerForUser', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockIsStripeResourceMissing.mockReturnValue(false)
    mockClearStripeCustomerByCustomerId.mockResolvedValue({ count: 0, userIds: [] })
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

  it('self-heals a stale customer id: clears it and recovers by email on resource_missing', async () => {
    const missingError = new Error("No such customer: 'cus_dead'")
    // First call (stored id) throws resource_missing; the email-recovery lookup then returns a live customer.
    mockIterateCustomerSubscriptions
      .mockImplementationOnce(() => {
        throw missingError
      })
      .mockReturnValue(subscriptionIterator([]))
    mockIsStripeResourceMissing.mockReturnValue(true)
    mockClearStripeCustomerByCustomerId.mockResolvedValue({ count: 1, userIds: ['user-1'] })
    mockCustomersList.mockResolvedValue([
      { id: 'cus_live', email: 'user@example.com', deleted: false, metadata: { userId: 'user-1' } },
    ])

    const result = await resolveStripeCustomerForUser({
      userId: 'user-1',
      email: 'user@example.com',
      stripeCustomerId: 'cus_dead',
    })

    expect(mockClearStripeCustomerByCustomerId).toHaveBeenCalledWith('cus_dead')
    expect(mockInvalidateBillingCache).toHaveBeenCalledWith('user-1')
    expect(result.customerId).toBe('cus_live')
  })

  it('rethrows non-resource_missing Stripe errors instead of clearing the id', async () => {
    const rateLimited = new Error('rate limited')
    mockIterateCustomerSubscriptions.mockImplementationOnce(() => {
      throw rateLimited
    })
    mockIsStripeResourceMissing.mockReturnValue(false)

    await expect(
      resolveStripeCustomerForUser({
        userId: 'user-1',
        email: 'user@example.com',
        stripeCustomerId: 'cus_x',
      }),
    ).rejects.toThrow('rate limited')
    expect(mockClearStripeCustomerByCustomerId).not.toHaveBeenCalled()
  })
})

describe('resolveOrCreateStripeCustomer', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockIsStripeResourceMissing.mockReturnValue(false)
    mockClearStripeCustomerByCustomerId.mockResolvedValue({ count: 0, userIds: [] })
    mockEnsureStripeCustomerUserId.mockResolvedValue('linked')
    mockLinkStripeCustomerToUser.mockResolvedValue(undefined)
  })

  it('returns the stored customer id without creating a new customer', async () => {
    mockIterateCustomerSubscriptions.mockReturnValue(subscriptionIterator([]))

    const result = await resolveOrCreateStripeCustomer({
      userId: 'user-1',
      email: 'user@example.com',
      stripeCustomerId: 'cus_stored',
    })

    expect(result).toEqual({ status: 'ok', customerId: 'cus_stored' })
    expect(mockCreateStripeCustomer).not.toHaveBeenCalled()
    // Same id as stored → no re-link write.
    expect(mockLinkStripeCustomerToUser).not.toHaveBeenCalled()
  })

  it('adopts a customer recovered by email and persists the link', async () => {
    mockIterateCustomerSubscriptions.mockReturnValue(subscriptionIterator([]))
    mockCustomersList.mockResolvedValue([
      { id: 'cus_email', email: 'user@example.com', deleted: false, metadata: { userId: 'user-1' } },
    ])

    const result = await resolveOrCreateStripeCustomer({
      userId: 'user-1',
      email: 'user@example.com',
      stripeCustomerId: null,
    })

    expect(result).toEqual({ status: 'ok', customerId: 'cus_email' })
    expect(mockLinkStripeCustomerToUser).toHaveBeenCalledWith('user-1', 'cus_email')
    expect(mockCreateStripeCustomer).not.toHaveBeenCalled()
  })

  it('creates a new customer when none exists by id or email', async () => {
    mockCustomersList.mockResolvedValue([])
    mockCreateStripeCustomer.mockResolvedValue({ id: 'cus_new' })

    const result = await resolveOrCreateStripeCustomer({
      userId: 'user-1',
      email: 'user@example.com',
      stripeCustomerId: null,
    })

    expect(mockCreateStripeCustomer).toHaveBeenCalledWith({ email: 'user@example.com', userId: 'user-1' })
    expect(mockLinkStripeCustomerToUser).toHaveBeenCalledWith('user-1', 'cus_new')
    expect(result).toEqual({ status: 'ok', customerId: 'cus_new' })
  })

  it('returns foreign when the resolved customer is already linked to another user in the DB (P2002)', async () => {
    mockIterateCustomerSubscriptions.mockReturnValue(subscriptionIterator([]))
    mockCustomersList.mockResolvedValue([
      { id: 'cus_email', email: 'user@example.com', deleted: false, metadata: { userId: 'user-1' } },
    ])
    // Stripe metadata check passes (ensureStripeCustomerUserId → 'linked'), but the id is already
    // stored on another user's row → the unique constraint fires P2002; treat it as foreign.
    const p2002 = new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
      code: 'P2002',
      clientVersion: 'test',
    })
    mockLinkStripeCustomerToUser.mockRejectedValue(p2002)

    const result = await resolveOrCreateStripeCustomer({
      userId: 'user-1',
      email: 'user@example.com',
      stripeCustomerId: null,
    })

    expect(result).toEqual({ status: 'foreign' })
    expect(mockCreateStripeCustomer).not.toHaveBeenCalled()
  })

  it('rethrows a non-P2002 DB error from linkStripeCustomerToUser', async () => {
    mockIterateCustomerSubscriptions.mockReturnValue(subscriptionIterator([]))
    mockCustomersList.mockResolvedValue([
      { id: 'cus_email', email: 'user@example.com', deleted: false, metadata: { userId: 'user-1' } },
    ])
    mockLinkStripeCustomerToUser.mockRejectedValue(new Error('db down'))

    await expect(
      resolveOrCreateStripeCustomer({
        userId: 'user-1',
        email: 'user@example.com',
        stripeCustomerId: null,
      }),
    ).rejects.toThrow('db down')
  })

  it('returns foreign when the resolved customer belongs to another app user', async () => {
    mockIterateCustomerSubscriptions.mockReturnValue(subscriptionIterator([]))
    mockEnsureStripeCustomerUserId.mockResolvedValue('foreign')

    const result = await resolveOrCreateStripeCustomer({
      userId: 'user-1',
      email: 'user@example.com',
      stripeCustomerId: 'cus_foreign',
    })

    expect(result).toEqual({ status: 'foreign' })
    expect(mockCreateStripeCustomer).not.toHaveBeenCalled()
    expect(mockLinkStripeCustomerToUser).not.toHaveBeenCalled()
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
