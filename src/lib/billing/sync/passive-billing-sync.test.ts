import { beforeEach, describe, expect, it, vi } from 'vitest'
import type Stripe from 'stripe'

vi.mock('@/lib/infra/logger', () => ({
  createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() }),
}))

vi.mock('@/lib/billing/checkout/stripe-checkout', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/billing/checkout/stripe-checkout')>()
  return {
    ...actual,
    resolveStripeCustomerForUser: vi.fn(),
  }
})

vi.mock('@/lib/billing/subscription/subscription-state', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/billing/subscription/subscription-state')>()
  return {
    ...actual,
    touchUserLastStripeSyncAt: vi.fn(),
    resolveAppUserIdForSubscription: vi.fn(),
  }
})

vi.mock('@/lib/billing/sync/user-billing-state', () => ({
  getCachedUserStripeInfo: vi.fn(),
  getFreshUserStripeInfo: vi.fn(),
}))

vi.mock('@/lib/billing/subscription/stripe-subscription-persist', () => ({
  applySubscriptionAccessFromStripe: vi.fn(),
}))

vi.mock('@/lib/billing/stripe-api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/billing/stripe-api')>()
  return {
    ...actual,
    fetchSubscriptionDetails: vi.fn(),
  }
})

import { fetchSubscriptionDetails } from '@/lib/billing/stripe-api'
import { resolveAppUserIdForSubscription } from '@/lib/billing/subscription/subscription-state'
import { resolveStripeCustomerForUser } from '@/lib/billing/checkout/stripe-checkout'
import { getCachedUserStripeInfo } from '@/lib/billing/sync/user-billing-state'
import { applySubscriptionAccessFromStripe } from '@/lib/billing/subscription/stripe-subscription-persist'
import {
  maybeReconcileOrphanSubscriptionForUser,
  reconcileOrphanStripeSubscriptionForUser,
} from '@/lib/billing/sync/passive-billing-sync'

const mockResolveAppUserIdForSubscription = resolveAppUserIdForSubscription as ReturnType<typeof vi.fn>
const mockGetCachedUserStripeInfo = getCachedUserStripeInfo as ReturnType<typeof vi.fn>
const mockResolveStripeCustomerForUser = resolveStripeCustomerForUser as ReturnType<typeof vi.fn>
const mockApplySubscriptionAccessFromStripe = applySubscriptionAccessFromStripe as ReturnType<typeof vi.fn>
const mockFetchSubscriptionDetails = fetchSubscriptionDetails as ReturnType<typeof vi.fn>

const blockingSubscription = {
  id: 'sub_123',
  status: 'active',
  metadata: { userId: 'user-1' },
  customer: 'cus_123',
  start_date: 1_746_724_800,
  cancel_at_period_end: false,
  cancel_at: null,
  canceled_at: null,
  items: {
    data: [{
      current_period_end: 1_749_403_200,
      price: { id: 'price_monthly', recurring: { interval: 'month' } },
    }],
  },
} as unknown as Stripe.Subscription

beforeEach(() => {
  vi.clearAllMocks()
  mockResolveStripeCustomerForUser.mockResolvedValue({ customerId: null, blockingSubscription: null })
  mockApplySubscriptionAccessFromStripe.mockResolvedValue('updated')
  mockFetchSubscriptionDetails.mockResolvedValue(null)
  mockResolveAppUserIdForSubscription.mockResolvedValue(null)
})

describe('reconcileOrphanStripeSubscriptionForUser', () => {
  it('returns false when the user already has a linked subscription', async () => {
    mockGetCachedUserStripeInfo.mockResolvedValue({
      email: 'user@example.com',
      stripeCustomerId: 'cus_123',
      stripeSubscriptionId: 'sub_123',
    })

    const linked = await reconcileOrphanStripeSubscriptionForUser('user-1')

    expect(linked).toBe(false)
    expect(mockApplySubscriptionAccessFromStripe).not.toHaveBeenCalled()
  })

  it('links a recovered Stripe subscription to the local user', async () => {
    mockGetCachedUserStripeInfo.mockResolvedValue({
      email: 'user@example.com',
      stripeCustomerId: null,
      stripeSubscriptionId: null,
    })
    mockResolveAppUserIdForSubscription.mockResolvedValue('user-1')
    mockResolveStripeCustomerForUser.mockResolvedValue({
      customerId: 'cus_123',
      blockingSubscription,
    })

    const linked = await reconcileOrphanStripeSubscriptionForUser('user-1')

    expect(linked).toBe(true)
    expect(mockApplySubscriptionAccessFromStripe).toHaveBeenCalledWith(
      expect.objectContaining({
        subscriptionId: 'sub_123',
        userId: 'user-1',
        customerId: 'cus_123',
        status: 'active',
      }),
    )
  })

  it('skips user resolution when subscription metadata already matches the user', async () => {
    mockGetCachedUserStripeInfo.mockResolvedValue({
      email: 'user@example.com',
      stripeCustomerId: 'cus_123',
      stripeSubscriptionId: null,
    })

    const linked = await reconcileOrphanStripeSubscriptionForUser('user-1', {
      customerId: 'cus_123',
      blockingSubscription: {
        ...blockingSubscription,
        metadata: { userId: 'user-1' },
      },
    })

    expect(linked).toBe(true)
    expect(mockResolveAppUserIdForSubscription).not.toHaveBeenCalled()
  })

  it('fetches subscription details when the list payload is missing interval', async () => {
    mockGetCachedUserStripeInfo.mockResolvedValue({
      email: 'user@example.com',
      stripeCustomerId: 'cus_123',
      stripeSubscriptionId: null,
    })
    mockResolveAppUserIdForSubscription.mockResolvedValue('user-1')
    mockFetchSubscriptionDetails.mockResolvedValue({
      customerId: 'cus_123',
      startDate: new Date('2026-06-01T00:00:00.000Z'),
      currentPeriodEnd: new Date('2026-07-01T00:00:00.000Z'),
      interval: 'year',
      status: 'active',
      userId: 'user-1',
      cancelAtPeriodEnd: false,
    })

    const subscriptionWithoutInterval = {
      ...blockingSubscription,
      items: { data: [{ current_period_end: 1_749_403_200, price: 'price_123' }] },
    } as unknown as Stripe.Subscription

    const linked = await reconcileOrphanStripeSubscriptionForUser('user-1', {
      customerId: 'cus_123',
      blockingSubscription: subscriptionWithoutInterval,
    })

    expect(linked).toBe(true)
    expect(mockFetchSubscriptionDetails).toHaveBeenCalledWith('sub_123')
    expect(mockApplySubscriptionAccessFromStripe).toHaveBeenCalledWith(
      expect.objectContaining({ subscriptionInterval: 'year' }),
    )
  })

  it('links via a checkout eligibility hint without re-resolving the Stripe customer', async () => {
    mockGetCachedUserStripeInfo.mockResolvedValue({
      email: 'user@example.com',
      stripeCustomerId: 'cus_123',
      stripeSubscriptionId: null,
    })
    mockResolveAppUserIdForSubscription.mockResolvedValue('user-1')

    const linked = await reconcileOrphanStripeSubscriptionForUser('user-1', {
      customerId: 'cus_123',
      blockingSubscription,
    })

    expect(linked).toBe(true)
    expect(mockResolveStripeCustomerForUser).not.toHaveBeenCalled()
    expect(mockApplySubscriptionAccessFromStripe).toHaveBeenCalledWith(
      expect.objectContaining({
        subscriptionId: 'sub_123',
        userId: 'user-1',
        customerId: 'cus_123',
      }),
    )
  })

  it('skips linking when subscription metadata belongs to another user', async () => {
    mockGetCachedUserStripeInfo.mockResolvedValue({
      email: 'user@example.com',
      stripeCustomerId: 'cus_123',
      stripeSubscriptionId: null,
    })
    mockResolveAppUserIdForSubscription.mockResolvedValue('user-2')
    mockResolveStripeCustomerForUser.mockResolvedValue({
      customerId: 'cus_123',
      blockingSubscription: {
        ...blockingSubscription,
        metadata: { userId: 'user-2' },
      },
    })

    const linked = await reconcileOrphanStripeSubscriptionForUser('user-1')

    expect(linked).toBe(false)
    expect(mockApplySubscriptionAccessFromStripe).not.toHaveBeenCalled()
  })
})

describe('maybeReconcileOrphanSubscriptionForUser', () => {
  it('returns false when user already has a linked subscription', async () => {
    mockGetCachedUserStripeInfo.mockResolvedValue({
      email: 'user@example.com',
      stripeSubscriptionId: 'sub_123',
      lastStripeSyncAt: null,
    })

    const linked = await maybeReconcileOrphanSubscriptionForUser('user-1')

    expect(linked).toBe(false)
    expect(mockResolveStripeCustomerForUser).not.toHaveBeenCalled()
  })

  it('runs orphan reconcile when user has email but no local subscription id', async () => {
    mockGetCachedUserStripeInfo.mockResolvedValue({
      email: 'user@example.com',
      stripeSubscriptionId: null,
      lastStripeSyncAt: null,
    })
    mockResolveAppUserIdForSubscription.mockResolvedValue('user-1')
    mockResolveStripeCustomerForUser.mockResolvedValue({
      customerId: 'cus_123',
      blockingSubscription,
    })

    const linked = await maybeReconcileOrphanSubscriptionForUser('user-1')

    expect(linked).toBe(true)
    expect(mockApplySubscriptionAccessFromStripe).toHaveBeenCalled()
  })
})
