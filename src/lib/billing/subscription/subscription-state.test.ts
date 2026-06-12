import { beforeEach, describe, expect, it, vi } from 'vitest'

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
  mockClearStripeCustomerByCustomerIdInDb: vi.fn(),
  mockClearStripeSubscriptionBySubIdInDb: vi.fn(),
  mockUpdateSubscriptionStateInDb: vi.fn(),
  mockUpdateUserStripeSubscriptionInDb: vi.fn(),
  mockTouchUserLastStripeSyncAtInDb: vi.fn(),
  mockGetUserIdByStripeCustomerId: vi.fn(),
  mockGetUserById: vi.fn(),
  mockRetrieveStripeCustomer: vi.fn(),
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
    mockGetUserById.mockResolvedValue({ id: 'user-sub' })
    mockRetrieveStripeCustomer.mockResolvedValue({ id: 'cus_1', metadata: {} })
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
    mockRetrieveStripeCustomer.mockResolvedValue({
      id: 'cus_1',
      metadata: { userId: 'user-meta' },
    })
    mockGetUserById.mockResolvedValue({ id: 'user-meta' })

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
