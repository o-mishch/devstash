import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  mockClearStripeCustomerByCustomerIdInDb,
  mockClearStripeSubscriptionBySubIdInDb,
  mockUpdateSubscriptionStateInDb,
  mockUpdateUserStripeSubscriptionInDb,
  mockTouchUserLastStripeSyncAtInDb,
  mockInvalidateProAccessForUserIds,
  mockGetUserIdByStripeCustomerId,
  mockGetUserById,
  mockRetrieveStripeCustomer,
} = vi.hoisted(() => ({
  mockClearStripeCustomerByCustomerIdInDb: vi.fn(),
  mockClearStripeSubscriptionBySubIdInDb: vi.fn(),
  mockUpdateSubscriptionStateInDb: vi.fn(),
  mockUpdateUserStripeSubscriptionInDb: vi.fn(),
  mockTouchUserLastStripeSyncAtInDb: vi.fn(),
  mockInvalidateProAccessForUserIds: vi.fn(),
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

vi.mock('@/lib/billing/access/pro-access-cache', () => ({
  invalidateProAccessForUserIds: mockInvalidateProAccessForUserIds,
}))

import {
  clearStripeCustomerByCustomerId,
  clearStripeSubscriptionBySubId,
  resolveAppUserIdForSubscription,
  touchUserLastStripeSyncAt,
  updateSubscriptionState,
  updateUserStripeSubscription,
} from './subscription-state'

describe('subscription-state', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockInvalidateProAccessForUserIds.mockResolvedValue(undefined)
  })

  it('invalidates Pro cache after clearing a Stripe customer', async () => {
    mockClearStripeCustomerByCustomerIdInDb.mockResolvedValue({ count: 1, userIds: ['user-1'] })

    await clearStripeCustomerByCustomerId('cus_1')

    expect(mockInvalidateProAccessForUserIds).toHaveBeenCalledWith(['user-1'])
  })

  it('invalidates Pro cache after updating user subscription', async () => {
    mockUpdateUserStripeSubscriptionInDb.mockResolvedValue({
      result: { id: 'user-1' },
      userIds: ['user-1'],
    })

    await updateUserStripeSubscription('user-1', {
      stripeCustomerId: 'cus_1',
      stripeSubscriptionId: 'sub_1',
      isPro: true,
    })

    expect(mockInvalidateProAccessForUserIds).toHaveBeenCalledWith(['user-1'])
  })

  it('invalidates Pro cache after updating subscription state by sub ID', async () => {
    mockUpdateSubscriptionStateInDb.mockResolvedValue({ count: 1, userIds: ['user-1', 'user-2'] })

    await updateSubscriptionState('sub_1', { isPro: false })

    expect(mockInvalidateProAccessForUserIds).toHaveBeenCalledWith(['user-1', 'user-2'])
  })

  it('invalidates Pro cache after clearing subscription by sub ID', async () => {
    mockClearStripeSubscriptionBySubIdInDb.mockResolvedValue({ count: 1, userIds: ['user-1'] })

    await clearStripeSubscriptionBySubId('sub_1')

    expect(mockInvalidateProAccessForUserIds).toHaveBeenCalledWith(['user-1'])
  })

  it('invalidates Pro cache for conflicted users when updating subscription link', async () => {
    mockUpdateUserStripeSubscriptionInDb.mockResolvedValue({
      result: { id: 'user-2' },
      userIds: ['user-2', 'user-1'],
    })

    await updateUserStripeSubscription('user-2', {
      stripeCustomerId: 'cus_1',
      stripeSubscriptionId: 'sub_1',
      isPro: true,
    })

    expect(mockInvalidateProAccessForUserIds).toHaveBeenCalledWith(['user-2', 'user-1'])
  })

  it('does not invalidate Pro cache when only touching lastStripeSyncAt', async () => {
    await touchUserLastStripeSyncAt('user-1')

    expect(mockTouchUserLastStripeSyncAtInDb).toHaveBeenCalledWith('user-1')
    expect(mockInvalidateProAccessForUserIds).not.toHaveBeenCalled()
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
    expect(mockGetUserById).toHaveBeenCalledWith('user-sub')
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
