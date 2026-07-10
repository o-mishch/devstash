import { beforeEach, describe, expect, it, vi } from 'vitest'
import type Stripe from 'stripe'
import type {
  clearStripeCustomerByCustomerId,
  clearStripeSubscriptionBySubId,
  getUserIdByStripeCustomerId,
  updateSubscriptionState,
  updateUserStripeSubscription,
} from '@/lib/db/stripe'
import type { getUserById } from '@/lib/db/users'
import type { retrieveStripeCustomer } from '@/lib/billing/stripe-api'

// Minimal-but-complete Stripe.Customer fixture builder — satisfies every required field so callers
// can override just the properties a test cares about without an `as`/`as unknown as` cast.
function stripeCustomerFixture(overrides: Partial<Stripe.Customer> = {}): Stripe.Customer {
  return {
    id: 'cus_1',
    object: 'customer',
    balance: 0,
    created: 0,
    default_source: null,
    description: null,
    email: null,
    invoice_settings: {
      custom_fields: null,
      default_payment_method: null,
      footer: null,
      rendering_options: null,
    },
    livemode: false,
    metadata: {},
    shipping: null,
    ...overrides,
  }
}

const {
  mockClearStripeCustomerByCustomerIdInDb,
  mockClearStripeSubscriptionBySubIdInDb,
  mockUpdateSubscriptionStateInDb,
  mockUpdateUserStripeSubscriptionInDb,
  mockTouchUserLastStripeSyncAtInDb,
  mockGetUserIdByStripeCustomerId,
  mockGetUserById,
  mockRetrieveStripeCustomer,
} = vi.hoisted(() => ({
  mockClearStripeCustomerByCustomerIdInDb: vi.fn<typeof clearStripeCustomerByCustomerId>(),
  mockClearStripeSubscriptionBySubIdInDb: vi.fn<typeof clearStripeSubscriptionBySubId>(),
  mockUpdateSubscriptionStateInDb: vi.fn<typeof updateSubscriptionState>(),
  mockUpdateUserStripeSubscriptionInDb: vi.fn<typeof updateUserStripeSubscription>(),
  mockTouchUserLastStripeSyncAtInDb: vi.fn<typeof import('@/lib/db/stripe').touchUserLastStripeSyncAt>(),
  mockGetUserIdByStripeCustomerId: vi.fn<typeof getUserIdByStripeCustomerId>(),
  mockGetUserById: vi.fn<typeof getUserById>(),
  mockRetrieveStripeCustomer: vi.fn<typeof retrieveStripeCustomer>(),
}))

vi.mock('@/lib/db/stripe', () => ({
  clearStripeCustomerByCustomerId: mockClearStripeCustomerByCustomerIdInDb,
  clearStripeSubscriptionBySubId: mockClearStripeSubscriptionBySubIdInDb,
  updateSubscriptionState: mockUpdateSubscriptionStateInDb,
  updateUserStripeSubscription: mockUpdateUserStripeSubscriptionInDb,
  touchUserLastStripeSyncAt: mockTouchUserLastStripeSyncAtInDb,
  getUserIdByStripeCustomerId: mockGetUserIdByStripeCustomerId,
}))

vi.mock('@/lib/db/users', () => ({
  getUserById: mockGetUserById,
}))

vi.mock('@/lib/billing/stripe-api', () => ({
  retrieveStripeCustomer: mockRetrieveStripeCustomer,
}))

import {
  resolveAppUserIdForSubscription,
  touchUserLastStripeSyncAt,
} from './subscription-state'

describe('subscription-state', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('calls DB layer when touching lastStripeSyncAt', async () => {
    await touchUserLastStripeSyncAt('user-1')

    expect(mockTouchUserLastStripeSyncAtInDb).toHaveBeenCalledWith('user-1')
  })
})

describe('resolveAppUserIdForSubscription', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockGetUserIdByStripeCustomerId.mockResolvedValue(null)
    mockGetUserById.mockResolvedValue({ id: 'user-sub', email: 'user-sub@example.com' })
    mockRetrieveStripeCustomer.mockResolvedValue(stripeCustomerFixture())
  })

  it('prefers subscription metadata when it matches the customer link', async () => {
    mockGetUserIdByStripeCustomerId.mockResolvedValue('user-sub')

    const userId = await resolveAppUserIdForSubscription({
      customerId: 'cus_1',
      subscriptionUserId: 'user-sub',
    })

    expect(userId).toBe('user-sub')
    expect(mockGetUserIdByStripeCustomerId).toHaveBeenCalledWith('cus_1')
    expect(mockGetUserById).not.toHaveBeenCalled()
  })

  it('uses DB user when subscription metadata mismatches the customer link', async () => {
    mockGetUserIdByStripeCustomerId.mockResolvedValue('user-db')

    const userId = await resolveAppUserIdForSubscription({
      customerId: 'cus_1',
      subscriptionUserId: 'user-sub',
    })

    expect(userId).toBe('user-db')
  })

  it('returns null when subscription metadata user does not exist locally', async () => {
    mockGetUserById.mockResolvedValue(null)

    const userId = await resolveAppUserIdForSubscription({
      customerId: null,
      subscriptionUserId: 'user-sub',
    })

    expect(userId).toBeNull()
    expect(mockGetUserIdByStripeCustomerId).not.toHaveBeenCalled()
  })

  it('falls back to the local user linked by stripeCustomerId', async () => {
    mockGetUserIdByStripeCustomerId.mockResolvedValue('user-db')

    const userId = await resolveAppUserIdForSubscription({
      customerId: 'cus_1',
      subscriptionUserId: null,
    })

    expect(userId).toBe('user-db')
    expect(mockRetrieveStripeCustomer).not.toHaveBeenCalled()
  })

  it('falls back to Stripe customer metadata when DB has no link', async () => {
    mockRetrieveStripeCustomer.mockResolvedValue(
      stripeCustomerFixture({ metadata: { userId: 'user-meta' } }),
    )
    mockGetUserById.mockResolvedValue({ id: 'user-meta', email: 'user-meta@example.com' })

    const userId = await resolveAppUserIdForSubscription({
      customerId: 'cus_1',
    })

    expect(userId).toBe('user-meta')
  })

  it('returns null when no resolution path matches', async () => {
    const userId = await resolveAppUserIdForSubscription({
      customerId: 'cus_1',
    })

    expect(userId).toBeNull()
  })
})
