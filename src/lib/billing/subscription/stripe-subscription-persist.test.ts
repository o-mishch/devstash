import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  mockUpdateSubscriptionState,
  mockUpdateUserStripeSubscription,
  mockClearStripeSubscriptionBySubId,
  mockResolveAppUserIdForSubscription,
  mockGetUserIdsByStripeSubscriptionId,
} = vi.hoisted(() => ({
  mockUpdateSubscriptionState: vi.fn(),
  mockUpdateUserStripeSubscription: vi.fn(),
  mockClearStripeSubscriptionBySubId: vi.fn(),
  mockResolveAppUserIdForSubscription: vi.fn(),
  mockGetUserIdsByStripeSubscriptionId: vi.fn(),
}))

vi.mock('@/lib/billing/subscription/subscription-state', () => ({
  updateSubscriptionState: mockUpdateSubscriptionState,
  updateUserStripeSubscription: mockUpdateUserStripeSubscription,
  clearStripeSubscriptionBySubId: mockClearStripeSubscriptionBySubId,
  resolveAppUserIdForSubscription: mockResolveAppUserIdForSubscription,
}))

vi.mock('@/lib/db/stripe', () => ({
  getUserIdsByStripeSubscriptionId: mockGetUserIdsByStripeSubscriptionId,
}))

vi.mock('@/lib/billing/stripe-api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/billing/stripe-api')>()
  return {
    ...actual,
    getIntervalFromSub: vi.fn(() => 'month'),
    getPrimarySubscriptionItem: () => ({ current_period_end: 1_749_403_200 }),
  }
})

vi.mock('@/lib/infra/redis', () => ({
  getRedis: vi.fn(() => null),
}))

vi.mock('@/lib/infra/logger', () => ({
  createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() }),
}))

import type Stripe from 'stripe'
import {
  applySubscriptionAccessFromStripe,
  applySubscriptionStateWithBackfill,
  upsertSubscriptionStateFromObject,
} from './stripe-subscription-persist'

describe('applySubscriptionAccessFromStripe', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockUpdateSubscriptionState.mockResolvedValue({ count: 1 })
    mockUpdateUserStripeSubscription.mockResolvedValue(undefined)
    mockClearStripeSubscriptionBySubId.mockResolvedValue({ count: 1 })
  })

  it('clears local link when subscription is missing from Stripe', async () => {
    const result = await applySubscriptionAccessFromStripe({
      subscriptionId: 'sub_1',
      status: null,
      missingFromStripe: true,
    })

    expect(result).toBe('cleared')
    expect(mockClearStripeSubscriptionBySubId).toHaveBeenCalledWith('sub_1', undefined)
  })

  it('clears local link for canceled status without Pro access', async () => {
    const result = await applySubscriptionAccessFromStripe({
      subscriptionId: 'sub_1',
      status: 'canceled',
    })

    expect(result).toBe('cleared')
    expect(mockClearStripeSubscriptionBySubId).toHaveBeenCalled()
  })

  it('returns revoked for unpaid status without clearing the subscription link', async () => {
    const result = await applySubscriptionAccessFromStripe({
      subscriptionId: 'sub_1',
      status: 'unpaid',
      userId: 'user-1',
      customerId: 'cus_1',
    })

    expect(result).toBe('revoked')
    expect(mockUpdateSubscriptionState).toHaveBeenCalledWith(
      'sub_1',
      expect.objectContaining({ isPro: false }),
    )
  })

  it('returns updated when Pro access is granted and rows change', async () => {
    const result = await applySubscriptionAccessFromStripe({
      subscriptionId: 'sub_1',
      status: 'active',
      userId: 'user-1',
      customerId: 'cus_1',
    })

    expect(result).toBe('updated')
  })

  it('returns unchanged when Pro access is granted but no user link is available', async () => {
    mockUpdateSubscriptionState.mockResolvedValue({ count: 0 })

    const result = await applySubscriptionAccessFromStripe({
      subscriptionId: 'sub_1',
      status: 'active',
    })

    expect(result).toBe('unchanged')
  })

  it('uses explicit grantsAccess override for checkout fulfillment', async () => {
    const result = await applySubscriptionAccessFromStripe({
      subscriptionId: 'sub_1',
      status: 'incomplete',
      grantsAccess: true,
      userId: 'user-1',
      customerId: 'cus_1',
    })

    expect(result).toBe('updated')
    expect(mockUpdateSubscriptionState).toHaveBeenCalledWith(
      'sub_1',
      expect.objectContaining({ isPro: true }),
    )
  })
})

describe('applySubscriptionStateWithBackfill', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockUpdateSubscriptionState.mockResolvedValue({ count: 0 })
    mockUpdateUserStripeSubscription.mockResolvedValue(undefined)
    mockResolveAppUserIdForSubscription.mockResolvedValue('user-1')
  })

  it('backfills via userId when subscription row is missing', async () => {
    const result = await applySubscriptionStateWithBackfill({
      subscriptionId: 'sub_1',
      isPro: true,
      userId: 'user-1',
      customerId: 'cus_1',
      subscriptionStart: new Date('2026-01-01T00:00:00.000Z'),
    })

    expect(result).toEqual({ rowsUpdated: 1 })
    expect(mockUpdateUserStripeSubscription).toHaveBeenCalledWith(
      'user-1',
      expect.objectContaining({
        stripeSubscriptionId: 'sub_1',
        stripeCustomerId: 'cus_1',
        isPro: true,
      }),
    )
  })

  it('resolves userId from customer when not provided', async () => {
    mockResolveAppUserIdForSubscription.mockResolvedValue('user-2')

    await applySubscriptionStateWithBackfill({
      subscriptionId: 'sub_1',
      isPro: true,
      customerId: 'cus_1',
    })

    expect(mockResolveAppUserIdForSubscription).toHaveBeenCalledWith({
      customerId: 'cus_1',
      subscriptionUserId: undefined,
    })
    expect(mockUpdateUserStripeSubscription).toHaveBeenCalledWith('user-2', expect.any(Object))
  })

  it('writes explicit null currentPeriodEnd when clearing period data', async () => {
    mockUpdateSubscriptionState.mockResolvedValue({ count: 1 })

    await applySubscriptionStateWithBackfill({
      subscriptionId: 'sub_1',
      isPro: false,
      currentPeriodEnd: null,
    })

    expect(mockUpdateSubscriptionState).toHaveBeenCalledWith(
      'sub_1',
      expect.objectContaining({ stripeCurrentPeriodEnd: null }),
    )
  })
})

const activeSubscription = {
  id: 'sub_123',
  status: 'active',
  customer: 'cus_123',
  metadata: {},
  start_date: 1_746_724_800,
  cancel_at_period_end: false,
  cancel_at: null,
  canceled_at: null,
  items: { data: [{ current_period_end: 1_749_403_200 }] },
} as Stripe.Subscription

describe('upsertSubscriptionStateFromObject', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockResolveAppUserIdForSubscription.mockResolvedValue(null)
    mockUpdateSubscriptionState.mockResolvedValue({ count: 0 })
    mockGetUserIdsByStripeSubscriptionId.mockResolvedValue([])
  })

  it('retries when a granting status is unchanged but no app user is linked', async () => {
    await expect(
      upsertSubscriptionStateFromObject(activeSubscription, 'customer.subscription.created'),
    ).rejects.toThrow(Error)
  })

  it('accepts unchanged outcomes when the subscription is already linked locally', async () => {
    mockGetUserIdsByStripeSubscriptionId.mockResolvedValue(['user-1'])

    await expect(
      upsertSubscriptionStateFromObject(activeSubscription, 'customer.subscription.updated'),
    ).resolves.toBeUndefined()
  })
})
