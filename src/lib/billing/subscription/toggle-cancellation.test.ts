import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { setSubscriptionCancelAtPeriodEnd as SetSubscriptionCancelAtPeriodEndFn } from '@/lib/infra/stripe'
import type {
  getCachedLiveSubscriptionState as GetCachedLiveSubscriptionStateFn,
  getCachedUserStripeInfo as GetCachedUserStripeInfoFn,
} from '@/lib/billing/sync/user-billing-state'
import type {
  getFreshVerifiedProAccess as GetFreshVerifiedProAccessFn,
  markFreshProAccessResolved as MarkFreshProAccessResolvedFn,
} from '@/lib/billing/access/pro-access-resolution'
import type { applyLiveSubscriptionAccessFromStripe as ApplyLiveSubscriptionAccessFromStripeFn } from '@/lib/billing/subscription/stripe-subscription-persist'
import type { syncSubscriptionStateForUser as SyncSubscriptionStateForUserFn } from '@/lib/billing/sync/passive-billing-sync'
import type { invalidateBillingCache as InvalidateBillingCacheFn } from '@/lib/infra/cache'

vi.mock('@/lib/infra/stripe', () => ({
  setSubscriptionCancelAtPeriodEnd: vi.fn<typeof SetSubscriptionCancelAtPeriodEndFn>(),
}))
vi.mock('@/lib/billing/sync/user-billing-state', () => ({
  getCachedUserStripeInfo: vi.fn<typeof GetCachedUserStripeInfoFn>(),
  getCachedLiveSubscriptionState: vi.fn<typeof GetCachedLiveSubscriptionStateFn>(),
}))
vi.mock('@/lib/billing/access/pro-access-resolution', () => ({
  getFreshVerifiedProAccess: vi.fn<typeof GetFreshVerifiedProAccessFn>(),
  markFreshProAccessResolved: vi.fn<typeof MarkFreshProAccessResolvedFn>(),
}))
vi.mock('@/lib/billing/subscription/stripe-subscription-persist', () => ({
  applyLiveSubscriptionAccessFromStripe: vi.fn<typeof ApplyLiveSubscriptionAccessFromStripeFn>(),
}))
vi.mock('@/lib/billing/sync/passive-billing-sync', () => ({
  syncSubscriptionStateForUser: vi.fn<typeof SyncSubscriptionStateForUserFn>(),
}))
vi.mock('@/lib/infra/cache', () => ({ invalidateBillingCache: vi.fn<typeof InvalidateBillingCacheFn>() }))
vi.mock('@/lib/infra/pino', () => ({
  logger: {
    child: () => ({
      info: vi.fn<(...args: unknown[]) => void>(),
      warn: vi.fn<(...args: unknown[]) => void>(),
      error: vi.fn<(...args: unknown[]) => void>(),
    }),
  },
}))

import { setSubscriptionCancelAtPeriodEnd } from '@/lib/infra/stripe'
import { getCachedLiveSubscriptionState, getCachedUserStripeInfo } from '@/lib/billing/sync/user-billing-state'
import { getFreshVerifiedProAccess, markFreshProAccessResolved } from '@/lib/billing/access/pro-access-resolution'
import { applyLiveSubscriptionAccessFromStripe } from '@/lib/billing/subscription/stripe-subscription-persist'
import { syncSubscriptionStateForUser } from '@/lib/billing/sync/passive-billing-sync'
import { invalidateBillingCache } from '@/lib/infra/cache'
import { toggleSubscriptionCancellation } from '@/lib/billing/subscription/toggle-cancellation'

const mockGetUserInfo = vi.mocked(getCachedUserStripeInfo)
const mockGetLiveState = vi.mocked(getCachedLiveSubscriptionState)
const mockSetCancel = vi.mocked(setSubscriptionCancelAtPeriodEnd)
const mockApplyAccess = vi.mocked(applyLiveSubscriptionAccessFromStripe)
const mockGetProAccess = vi.mocked(getFreshVerifiedProAccess)
const mockMarkPro = vi.mocked(markFreshProAccessResolved)
const mockSyncRecovery = vi.mocked(syncSubscriptionStateForUser)
const mockInvalidate = vi.mocked(invalidateBillingCache)

describe('toggleSubscriptionCancellation', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockGetUserInfo.mockResolvedValue({
      email: 'user@example.com',
      stripeCustomerId: 'cus_1',
      stripeSubscriptionId: 'sub_1',
      stripeSubscriptionStatus: 'active',
      isPro: true,
      stripeSubscriptionStart: null,
      stripeCurrentPeriodEnd: null,
      stripeSubscriptionInterval: null,
      stripeCancelAtPeriodEnd: false,
      stripeLastSyncAt: null,
      proExpiredAt: null,
    })
    mockGetLiveState.mockResolvedValue({
      exists: true,
      cancelAtPeriodEnd: false,
      currentPeriodEnd: null,
      interval: null,
      status: 'active',
    })
    mockGetProAccess.mockResolvedValue(true)
  })

  it('throws and skips Stripe when the user has no active subscription', async () => {
    mockGetUserInfo.mockResolvedValue({
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
    })

    await expect(toggleSubscriptionCancellation('user-1', true)).rejects.toThrow(
      'No active subscription found. Please contact support.',
    )
    expect(mockSetCancel).not.toHaveBeenCalled()
  })

  it('cancels, applies access, and invalidates the cache on success', async () => {
    await toggleSubscriptionCancellation('user-1', true)

    expect(mockSetCancel).toHaveBeenCalledWith('sub_1', true)
    expect(mockApplyAccess).toHaveBeenCalledWith(
      'sub_1',
      {
        exists: true,
        cancelAtPeriodEnd: false,
        currentPeriodEnd: null,
        interval: null,
        status: 'active',
      },
      {
        userId: 'user-1',
        customerId: 'cus_1',
      },
    )
    expect(mockMarkPro).toHaveBeenCalledWith('user-1', true)
    expect(mockInvalidate).toHaveBeenCalledWith('user-1')
    expect(mockSyncRecovery).not.toHaveBeenCalled()
  })

  it('passes cancel=false through to Stripe when reactivating', async () => {
    await toggleSubscriptionCancellation('user-1', false)
    expect(mockSetCancel).toHaveBeenCalledWith('sub_1', false)
  })

  it('throws the deliberate message without running sync recovery when live state is missing', async () => {
    mockGetLiveState.mockResolvedValue(null)

    await expect(toggleSubscriptionCancellation('user-1', true)).rejects.toThrow(
      'Unable to cancel subscription. Please try again.',
    )
    expect(mockSyncRecovery).not.toHaveBeenCalled()
    expect(mockApplyAccess).not.toHaveBeenCalled()
  })

  it('runs sync recovery and throws the refresh message on an unexpected Stripe failure', async () => {
    mockSetCancel.mockRejectedValue(new Error('Stripe 500'))

    await expect(toggleSubscriptionCancellation('user-1', false)).rejects.toThrow(
      'Unable to reactivate subscription. Please refresh billing settings and try again.',
    )
    expect(mockSyncRecovery).toHaveBeenCalledWith('user-1')
  })

  it('still throws the refresh message when sync recovery itself fails', async () => {
    mockSetCancel.mockRejectedValue(new Error('Stripe 500'))
    mockSyncRecovery.mockRejectedValue(new Error('recovery failed'))

    await expect(toggleSubscriptionCancellation('user-1', true)).rejects.toThrow(
      'Unable to cancel subscription. Please refresh billing settings and try again.',
    )
  })
})
