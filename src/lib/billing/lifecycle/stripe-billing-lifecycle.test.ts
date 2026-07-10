import { beforeEach, describe, expect, it, vi } from 'vitest'
import type {
  cancelSubscriptionImmediately as CancelSubscriptionImmediatelyFn,
  deleteStripeCustomer as DeleteStripeCustomerFn,
  updateStripeCustomerEmail as UpdateStripeCustomerEmailFn,
} from '@/lib/infra/stripe'
import type { getCachedUserStripeInfo as GetCachedUserStripeInfoFn } from '@/lib/billing/sync/user-billing-state'
import type { UserStripeInfo } from '@/lib/db/stripe'
import type { LogFn } from 'pino'

const baseUserStripeInfo: UserStripeInfo = {
  email: 'user@example.com',
  stripeCustomerId: null,
  stripeSubscriptionId: null,
  stripeSubscriptionStatus: null,
  isPro: false,
  stripeSubscriptionStart: null,
  stripeCurrentPeriodEnd: null,
  stripeSubscriptionInterval: null,
  stripeCancelAtPeriodEnd: false,
  stripeLastSyncAt: null,
  proExpiredAt: null,
}

vi.mock('@/lib/infra/stripe', () => ({
  cancelSubscriptionImmediately: vi.fn<typeof CancelSubscriptionImmediatelyFn>(),
  deleteStripeCustomer: vi.fn<typeof DeleteStripeCustomerFn>(),
  updateStripeCustomerEmail: vi.fn<typeof UpdateStripeCustomerEmailFn>(),
}))
const { mockGetCachedUserStripeInfo } = vi.hoisted(() => ({
  mockGetCachedUserStripeInfo: vi.fn<typeof GetCachedUserStripeInfoFn>(),
}))

vi.mock('@/lib/billing/sync/user-billing-state', () => ({
  getCachedUserStripeInfo: mockGetCachedUserStripeInfo,
}))

vi.mock('@/lib/infra/pino', () => ({
  logger: { child: () => ({ info: vi.fn<LogFn>(), error: vi.fn<LogFn>(), warn: vi.fn<LogFn>() }) },
}))

import { cancelSubscriptionImmediately, deleteStripeCustomer, updateStripeCustomerEmail } from '@/lib/infra/stripe'
import { teardownStripeBillingForUser, syncStripeCustomerEmailForUserSafe } from './stripe-billing-lifecycle'

const mockCancelSubscriptionImmediately = vi.mocked(cancelSubscriptionImmediately)
const mockDeleteStripeCustomer = vi.mocked(deleteStripeCustomer)
const mockUpdateStripeCustomerEmail = vi.mocked(updateStripeCustomerEmail)

beforeEach(() => {
  vi.clearAllMocks()
  mockCancelSubscriptionImmediately.mockResolvedValue(undefined)
  mockDeleteStripeCustomer.mockResolvedValue(undefined)
})

describe('teardownStripeBillingForUser', () => {
  it('no-ops when the user has no Stripe billing records', async () => {
    mockGetCachedUserStripeInfo.mockResolvedValue({
      ...baseUserStripeInfo,
      stripeCustomerId: null,
      stripeSubscriptionId: null,
    })

    await teardownStripeBillingForUser('user-1')

    expect(mockCancelSubscriptionImmediately).not.toHaveBeenCalled()
    expect(mockDeleteStripeCustomer).not.toHaveBeenCalled()
  })

  it('cancels the subscription and deletes the customer before account deletion', async () => {
    mockGetCachedUserStripeInfo.mockResolvedValue({
      ...baseUserStripeInfo,
      stripeCustomerId: 'cus_123',
      stripeSubscriptionId: 'sub_123',
    })

    await teardownStripeBillingForUser('user-1')

    expect(mockCancelSubscriptionImmediately).toHaveBeenCalledWith('sub_123')
    expect(mockDeleteStripeCustomer).toHaveBeenCalledWith('cus_123')
  })

  it('throws when subscription cancellation fails', async () => {
    mockGetCachedUserStripeInfo.mockResolvedValue({
      ...baseUserStripeInfo,
      stripeCustomerId: 'cus_123',
      stripeSubscriptionId: 'sub_123',
    })
    mockCancelSubscriptionImmediately.mockRejectedValue(new Error('Stripe unavailable'))

    await expect(teardownStripeBillingForUser('user-1')).rejects.toThrow('Stripe unavailable')
    expect(mockDeleteStripeCustomer).not.toHaveBeenCalled()
  })

  it('throws when customer deletion fails', async () => {
    mockGetCachedUserStripeInfo.mockResolvedValue({
      ...baseUserStripeInfo,
      stripeCustomerId: 'cus_123',
      stripeSubscriptionId: null,
    })
    mockDeleteStripeCustomer.mockRejectedValue(new Error('Stripe unavailable'))

    await expect(teardownStripeBillingForUser('user-1')).rejects.toThrow('Stripe unavailable')
  })
})

describe('syncStripeCustomerEmailForUserSafe', () => {
  it('swallows a Stripe failure so an already-committed email change is never 500ed', async () => {
    mockGetCachedUserStripeInfo.mockResolvedValue({ ...baseUserStripeInfo, stripeCustomerId: 'cus_123' })
    mockUpdateStripeCustomerEmail.mockRejectedValue(new Error('stripe down'))

    await expect(syncStripeCustomerEmailForUserSafe('user-1', 'new@example.com')).resolves.toBeUndefined()
    expect(mockUpdateStripeCustomerEmail).toHaveBeenCalledWith('cus_123', 'new@example.com')
  })

  it('no-ops (and never throws) when the user has no Stripe customer', async () => {
    mockGetCachedUserStripeInfo.mockResolvedValue({ ...baseUserStripeInfo, stripeCustomerId: null })

    await expect(syncStripeCustomerEmailForUserSafe('user-1', 'new@example.com')).resolves.toBeUndefined()
    expect(mockUpdateStripeCustomerEmail).not.toHaveBeenCalled()
  })
})
