import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/infra/logger', () => ({
  createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() }),
}))

vi.mock('@/lib/stripe', () => ({
  cancelAbandonedSubscription: vi.fn(),
  createPortalSession: vi.fn(),
  stripe: { charges: { retrieve: vi.fn() } },
}))

const {
  mockListStripeCustomersByEmail,
  mockIterateCustomerSubscriptions,
} = vi.hoisted(() => ({
  mockListStripeCustomersByEmail: vi.fn(),
  mockIterateCustomerSubscriptions: vi.fn(),
}))

vi.mock('@/lib/billing/stripe-api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/billing/stripe-api')>()
  return {
    ...actual,
    fetchCheckoutSessionDetails: vi.fn(),
    fetchLiveSubscriptionState: vi.fn(),
    fetchSubscriptionDetails: vi.fn(),
    listStripeCustomersByEmail: mockListStripeCustomersByEmail,
    iterateCustomerSubscriptions: mockIterateCustomerSubscriptions,
  }
})

vi.mock('@/lib/billing/config/billing-pricing', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/billing/config/billing-pricing')>()
  return {
    ...actual,
    isAllowedCheckoutPriceId: vi.fn(() => true),
  }
})

vi.mock('@/lib/billing/subscription/subscription-state', () => ({
  resolveAppUserIdForSubscription: vi.fn().mockResolvedValue('user-1'),
  clearStripeSubscriptionBySubId: vi.fn(),
  updateSubscriptionState: vi.fn(),
  updateUserStripeSubscription: vi.fn(),
}))

vi.mock('@/lib/billing/subscription/stripe-subscription-persist', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/billing/subscription/stripe-subscription-persist')>()
  return {
    ...actual,
    applySubscriptionAccessFromStripe: vi.fn(),
  }
})

const { mockGetUserStripeInfo } = vi.hoisted(() => ({
  mockGetUserStripeInfo: vi.fn(),
}))

vi.mock('@/lib/db/stripe', () => ({
  getUserStripeInfo: mockGetUserStripeInfo,
}))

vi.mock('react', () => ({
  cache: (fn: (...args: unknown[]) => unknown) => fn,
}))

vi.mock('@/lib/billing/sync/user-billing-state', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/billing/sync/user-billing-state')>()
  return {
    ...actual,
    getCachedUserStripeInfo: mockGetUserStripeInfo,
    getFreshUserStripeInfo: mockGetUserStripeInfo,
  }
})

vi.mock('@/lib/billing/emails/billing-payment-failed', () => ({
  sendBillingPaymentFailedEmail: vi.fn(),
}))

vi.mock('@/lib/billing/emails/billing-checkout-payment-failed', () => ({
  sendBillingCheckoutPaymentFailedEmail: vi.fn(),
}))

vi.mock('@/lib/billing/emails/billing-dispute-admin', () => ({
  sendBillingDisputeAdminEmail: vi.fn(),
}))

vi.mock('@/lib/billing/emails/billing-trial-ending', () => ({
  sendBillingTrialEndingEmail: vi.fn(),
}))


import {
  fetchLiveSubscriptionState,
  fetchCheckoutSessionDetails,
  fetchSubscriptionDetails,
} from '@/lib/billing/stripe-api'
import { isAllowedCheckoutPriceId } from '@/lib/billing/config/billing-pricing'
import {
  clearStripeSubscriptionBySubId,
  updateSubscriptionState,
  updateUserStripeSubscription,
} from '@/lib/billing/subscription/subscription-state'
import { applySubscriptionAccessFromStripe } from '@/lib/billing/subscription/stripe-subscription-persist'
import { finalizeCheckoutSessionForUser, validateCheckoutEligibility } from '../checkout/stripe-checkout'
import { maybeReconcileBillingStateForUser, syncSubscriptionStateForUser } from './passive-billing-sync'
import type Stripe from 'stripe'

const mockFetchCheckoutSessionDetails = fetchCheckoutSessionDetails as ReturnType<typeof vi.fn>
const mockFetchLiveSubscriptionState = fetchLiveSubscriptionState as ReturnType<typeof vi.fn>
const mockFetchSubscriptionDetails = fetchSubscriptionDetails as ReturnType<typeof vi.fn>
const mockIsAllowedCheckoutPriceId = isAllowedCheckoutPriceId as ReturnType<typeof vi.fn>
const mockClearStripeSubscriptionBySubId = clearStripeSubscriptionBySubId as ReturnType<typeof vi.fn>
const mockUpdateSubscriptionState = updateSubscriptionState as ReturnType<typeof vi.fn>
const mockUpdateUserStripeSubscription = updateUserStripeSubscription as ReturnType<typeof vi.fn>
const mockApplySubscriptionAccessFromStripe = applySubscriptionAccessFromStripe as ReturnType<typeof vi.fn>
async function* emptySubscriptionIterator() {
  // no subscriptions
}

function makeBlockingSubscription(overrides: Partial<Stripe.Subscription> = {}): Stripe.Subscription {
  return {
    id: 'sub_123',
    status: 'active',
    metadata: { userId: 'user-1' },
    customer: 'cus_123',
    start_date: 1_746_724_800,
    cancel_at_period_end: false,
    items: {
      data: [{
        current_period_end: 1_749_403_200,
        price: { id: 'price_monthly', recurring: { interval: 'month' } },
      }],
    },
    ...overrides,
  } as Stripe.Subscription
}

beforeEach(() => {
  vi.clearAllMocks()
  mockIsAllowedCheckoutPriceId.mockReturnValue(true)
  mockListStripeCustomersByEmail.mockResolvedValue([])
  mockIterateCustomerSubscriptions.mockReturnValue(emptySubscriptionIterator())
  mockFetchCheckoutSessionDetails.mockResolvedValue(null)
  mockFetchSubscriptionDetails.mockResolvedValue(null)
  mockUpdateSubscriptionState.mockResolvedValue({ count: 1 })
  mockClearStripeSubscriptionBySubId.mockResolvedValue({ count: 1 })
  mockUpdateUserStripeSubscription.mockResolvedValue(undefined)
})

describe('validateCheckoutEligibility', () => {
  it('rejects invalid price IDs', async () => {
    mockIsAllowedCheckoutPriceId.mockReturnValue(false)

    const result = await validateCheckoutEligibility('user-1', 'price_bad')

    expect(result).toEqual({ status: 'invalid_price' })
  })

  it('allows checkout when the user has no Stripe customer yet', async () => {
    mockGetUserStripeInfo.mockResolvedValue({ stripeCustomerId: null, email: null })

    const result = await validateCheckoutEligibility('user-1', 'price_good')

    expect(result).toEqual({ status: 'ok' })
  })

  it('reuses an existing Stripe customer recovered by email', async () => {
    mockGetUserStripeInfo.mockResolvedValue({ stripeCustomerId: null, email: 'user@example.com' })
    mockListStripeCustomersByEmail.mockResolvedValue([
      {
        id: 'cus_existing',
        email: 'user@example.com',
        metadata: { userId: 'user-1' },
      } as unknown as Stripe.Customer,
    ])
    mockIterateCustomerSubscriptions.mockReturnValue(emptySubscriptionIterator())

    const result = await validateCheckoutEligibility('user-1', 'price_good')

    expect(result).toEqual({ status: 'ok', customerId: 'cus_existing' })
  })

  it('rejects checkout when an existing subscription is found on a recovered customer', async () => {
    const blockingSubscription = makeBlockingSubscription({ id: 'sub_456', customer: 'cus_existing' })
    mockGetUserStripeInfo.mockResolvedValue({ stripeCustomerId: null, email: 'user@example.com' })
    mockListStripeCustomersByEmail.mockResolvedValue([
      {
        id: 'cus_existing',
        email: 'user@example.com',
        metadata: { userId: 'user-1' },
      } as unknown as Stripe.Customer,
    ])
    mockIterateCustomerSubscriptions.mockImplementation(async function* () {
      yield blockingSubscription
    })

    const result = await validateCheckoutEligibility('user-1', 'price_good')

    expect(result).toEqual({
      status: 'existing_subscription',
      customerId: 'cus_existing',
      subscriptionId: 'sub_456',
      subscriptionStatus: 'active',
      blockingSubscription,
    })
  })

  it('rejects checkout when a blocking subscription exists', async () => {
    const blockingSubscription = makeBlockingSubscription()
    mockGetUserStripeInfo.mockResolvedValue({ stripeCustomerId: 'cus_123', email: 'user@example.com' })
    mockIterateCustomerSubscriptions.mockImplementation(async function* () {
      yield blockingSubscription
    })

    const result = await validateCheckoutEligibility('user-1', 'price_good')

    expect(result).toEqual({
      status: 'existing_subscription',
      customerId: 'cus_123',
      subscriptionId: 'sub_123',
      subscriptionStatus: 'active',
      blockingSubscription,
    })
  })

  it('returns error when lookup fails', async () => {
    mockGetUserStripeInfo.mockRejectedValue(new Error('db unavailable'))

    const result = await validateCheckoutEligibility('user-1', 'price_good')

    expect(result).toEqual({ status: 'error' })
  })
})

describe('syncSubscriptionStateForUser', () => {
  it('returns no_subscription when the user has no local subscription id', async () => {
    mockGetUserStripeInfo.mockResolvedValue({ stripeSubscriptionId: null, email: null })

    const result = await syncSubscriptionStateForUser('user-1')

    expect(result).toEqual({ status: 'no_subscription' })
  })

  it('syncs after linking an orphan Stripe subscription', async () => {
    const periodEnd = new Date('2026-12-31T00:00:00.000Z')
    const blockingSubscription = makeBlockingSubscription()
    mockApplySubscriptionAccessFromStripe.mockResolvedValue('updated')
    mockGetUserStripeInfo
      .mockResolvedValueOnce({ email: 'user@example.com', stripeSubscriptionId: null, stripeCustomerId: null })
      .mockResolvedValueOnce({ email: 'user@example.com', stripeSubscriptionId: null, stripeCustomerId: null })
      .mockResolvedValueOnce({ stripeSubscriptionId: 'sub_123', stripeCustomerId: 'cus_123' })
    mockListStripeCustomersByEmail.mockResolvedValue([
      {
        id: 'cus_123',
        email: 'user@example.com',
        metadata: { userId: 'user-1' },
      } as unknown as Stripe.Customer,
    ])
    mockIterateCustomerSubscriptions.mockImplementation(async function* () {
      yield blockingSubscription
    })
    mockFetchLiveSubscriptionState.mockResolvedValue({
      exists: true,
      status: 'active',
      cancelAtPeriodEnd: false,
      currentPeriodEnd: periodEnd,
      interval: 'month',
    })

    const result = await syncSubscriptionStateForUser('user-1', { attemptOrphanReconcile: true })

    expect(result).toEqual({
      status: 'updated',
      subscriptionId: 'sub_123',
      stripeStatus: 'active',
      exists: true,
    })
  })

  it('returns unavailable when Stripe state cannot be fetched', async () => {
    mockGetUserStripeInfo.mockResolvedValue({ stripeSubscriptionId: 'sub_123' })
    mockFetchLiveSubscriptionState.mockResolvedValue(null)

    const result = await syncSubscriptionStateForUser('user-1')

    expect(result).toEqual({ status: 'unavailable', subscriptionId: 'sub_123' })
  })

  it('updates the local subscription state when Stripe still grants access', async () => {
    const periodEnd = new Date('2026-12-31T00:00:00.000Z')
    mockGetUserStripeInfo.mockResolvedValue({ stripeSubscriptionId: 'sub_123' })
    mockFetchLiveSubscriptionState.mockResolvedValue({
      exists: true,
      status: 'active',
      cancelAtPeriodEnd: false,
      currentPeriodEnd: periodEnd,
      interval: 'month',
    })

    const result = await syncSubscriptionStateForUser('user-1')

    expect(result).toEqual({
      status: 'updated',
      subscriptionId: 'sub_123',
      stripeStatus: 'active',
      exists: true,
    })
    expect(mockUpdateSubscriptionState).toHaveBeenCalledWith(
      'sub_123',
      expect.objectContaining({
        isPro: true,
        cancelAtPeriodEnd: false,
        currentPeriodEnd: periodEnd,
        subscriptionInterval: 'month',
      }),
    )
  })

  it('revokes local access when Stripe reports the subscription missing', async () => {
    mockGetUserStripeInfo.mockResolvedValue({ stripeSubscriptionId: 'sub_123' })
    mockFetchLiveSubscriptionState.mockResolvedValue({
      exists: false,
      status: null,
      cancelAtPeriodEnd: false,
      currentPeriodEnd: null,
      interval: null,
    })

    const result = await syncSubscriptionStateForUser('user-1')

    expect(result).toEqual({
      status: 'cleared',
      subscriptionId: 'sub_123',
      stripeStatus: null,
      exists: false,
    })
    expect(mockClearStripeSubscriptionBySubId).toHaveBeenCalledWith('sub_123', undefined)
  })

  it('retains the local link for incomplete subscriptions awaiting async payment', async () => {
    const periodEnd = new Date('2026-12-31T00:00:00.000Z')
    mockGetUserStripeInfo.mockResolvedValue({ stripeSubscriptionId: 'sub_123' })
    mockFetchLiveSubscriptionState.mockResolvedValue({
      exists: true,
      status: 'incomplete',
      cancelAtPeriodEnd: false,
      currentPeriodEnd: periodEnd,
      interval: 'month',
    })

    const result = await syncSubscriptionStateForUser('user-1')

    expect(result).toEqual({
      status: 'revoked',
      subscriptionId: 'sub_123',
      stripeStatus: 'incomplete',
      exists: true,
    })
    expect(mockUpdateSubscriptionState).toHaveBeenCalledWith(
      'sub_123',
      expect.objectContaining({
        isPro: false,
        currentPeriodEnd: periodEnd,
        subscriptionInterval: 'month',
      }),
    )
    expect(mockClearStripeSubscriptionBySubId).not.toHaveBeenCalled()
  })

  it('clears the local link when Stripe reports a canceled subscription', async () => {
    const periodEnd = new Date('2026-12-31T00:00:00.000Z')
    mockGetUserStripeInfo.mockResolvedValue({ stripeSubscriptionId: 'sub_123' })
    mockFetchLiveSubscriptionState.mockResolvedValue({
      exists: true,
      status: 'canceled',
      cancelAtPeriodEnd: false,
      currentPeriodEnd: periodEnd,
      interval: 'month',
    })

    const result = await syncSubscriptionStateForUser('user-1')

    expect(result).toEqual({
      status: 'cleared',
      subscriptionId: 'sub_123',
      stripeStatus: 'canceled',
      exists: true,
    })
    expect(mockClearStripeSubscriptionBySubId).toHaveBeenCalledWith('sub_123', periodEnd)
    expect(mockUpdateSubscriptionState).not.toHaveBeenCalled()
  })

  it('revokes local access without clearing the link for recoverable billing issues', async () => {
    const periodEnd = new Date('2026-12-31T00:00:00.000Z')
    mockGetUserStripeInfo.mockResolvedValue({ stripeSubscriptionId: 'sub_123' })
    mockFetchLiveSubscriptionState.mockResolvedValue({
      exists: true,
      status: 'unpaid',
      cancelAtPeriodEnd: false,
      currentPeriodEnd: periodEnd,
      interval: 'month',
    })

    const result = await syncSubscriptionStateForUser('user-1')

    expect(result).toEqual({
      status: 'revoked',
      subscriptionId: 'sub_123',
      stripeStatus: 'unpaid',
      exists: true,
    })
    expect(mockUpdateSubscriptionState).toHaveBeenCalledWith(
      'sub_123',
      expect.objectContaining({
        isPro: false,
        currentPeriodEnd: periodEnd,
        subscriptionInterval: 'month',
      }),
    )
    expect(mockClearStripeSubscriptionBySubId).not.toHaveBeenCalled()
  })
})

describe('maybeReconcileBillingStateForUser', () => {
  it('returns null without calling Stripe when sync is not needed', async () => {
    mockGetUserStripeInfo.mockResolvedValue({
      email: 'user@example.com',
      stripeCustomerId: 'cus_123',
      stripeSubscriptionId: 'sub_123',
      isPro: true,
      lastStripeSyncAt: new Date(),
      currentPeriodEnd: new Date('2026-12-31T00:00:00.000Z'),
    })

    const result = await maybeReconcileBillingStateForUser('user-1')

    expect(result).toBeNull()
    expect(mockFetchLiveSubscriptionState).not.toHaveBeenCalled()
  })

  it('runs sync when billing recovery signals are present', async () => {
    mockGetUserStripeInfo.mockResolvedValue({
      email: 'user@example.com',
      stripeCustomerId: 'cus_123',
      stripeSubscriptionId: 'sub_123',
      isPro: false,
      lastStripeSyncAt: new Date(),
      currentPeriodEnd: new Date('2026-12-31T00:00:00.000Z'),
    })
    mockFetchLiveSubscriptionState.mockResolvedValue({
      exists: true,
      status: 'active',
      cancelAtPeriodEnd: false,
      currentPeriodEnd: new Date('2026-12-31T00:00:00.000Z'),
      interval: 'month',
    })

    const result = await maybeReconcileBillingStateForUser('user-1')

    expect(result).toEqual({
      status: 'updated',
      subscriptionId: 'sub_123',
      stripeStatus: 'active',
      exists: true,
    })
  })
})

describe('finalizeCheckoutSessionForUser', () => {
  it('returns unavailable when Stripe fetch fails', async () => {
    mockFetchCheckoutSessionDetails.mockResolvedValue(null)

    const result = await finalizeCheckoutSessionForUser('user-1', 'cs_123')

    expect(result).toEqual({ status: 'unavailable' })
  })

  it('rejects an invalid checkout session without a subscription', async () => {
    mockFetchCheckoutSessionDetails.mockResolvedValue({
      customerId: 'cus_123',
      paymentStatus: 'paid',
      subscriptionId: null,
      userId: 'user-1',
    })

    const result = await finalizeCheckoutSessionForUser('user-1', 'cs_123')

    expect(result).toEqual({ status: 'invalid_session' })
  })

  it('rejects a checkout session owned by another user', async () => {
    mockFetchCheckoutSessionDetails.mockResolvedValue({
      customerId: 'cus_123',
      paymentStatus: 'paid',
      subscriptionId: 'sub_123',
      userId: 'user-2',
    })

    const result = await finalizeCheckoutSessionForUser('user-1', 'cs_123')

    expect(result).toEqual({ status: 'forbidden' })
  })

  it('persists the subscription for the signed-in user after Stripe redirect', async () => {
    mockFetchCheckoutSessionDetails.mockResolvedValue({
      customerId: 'cus_123',
      paymentStatus: 'paid',
      subscriptionId: 'sub_123',
      userId: 'user-1',
    })
    mockFetchSubscriptionDetails.mockResolvedValue({
      customerId: 'cus_123',
      currentPeriodEnd: new Date('2026-07-01T00:00:00.000Z'),
      interval: 'month',
      startDate: new Date('2026-06-01T00:00:00.000Z'),
      status: 'active',
      userId: 'user-1',
      cancelAtPeriodEnd: false,
    })
    mockUpdateSubscriptionState.mockResolvedValue({ count: 0 })

    const result = await finalizeCheckoutSessionForUser('user-1', 'cs_123')

    expect(result).toEqual({ status: 'ok', grantsAccess: true })
    expect(mockUpdateUserStripeSubscription).toHaveBeenCalledWith(
      'user-1',
      expect.objectContaining({
        stripeCustomerId: 'cus_123',
        stripeSubscriptionId: 'sub_123',
        isPro: true,
      }),
    )
  })
})
