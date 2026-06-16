import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/stripe', () => ({ setSubscriptionCancelAtPeriodEnd: vi.fn() }))
vi.mock('@/lib/billing/sync/user-billing-state', () => ({
  getCachedUserStripeInfo: vi.fn(),
  getCachedLiveSubscriptionState: vi.fn(),
}))
vi.mock('@/lib/billing/access/pro-access-resolution', () => ({
  getFreshVerifiedProAccess: vi.fn(),
  markFreshProAccessResolved: vi.fn(),
}))
vi.mock('@/lib/billing/subscription/stripe-subscription-persist', () => ({
  applyLiveSubscriptionAccessFromStripe: vi.fn(),
}))
vi.mock('@/lib/billing/sync/passive-billing-sync', () => ({ syncSubscriptionStateForUser: vi.fn() }))
vi.mock('@/lib/infra/cache', () => ({ invalidateBillingCache: vi.fn() }))
vi.mock('@/lib/infra/pino', () => ({
  logger: { child: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() }) },
}))

import { setSubscriptionCancelAtPeriodEnd } from '@/lib/stripe'
import { getCachedLiveSubscriptionState, getCachedUserStripeInfo } from '@/lib/billing/sync/user-billing-state'
import { getFreshVerifiedProAccess, markFreshProAccessResolved } from '@/lib/billing/access/pro-access-resolution'
import { applyLiveSubscriptionAccessFromStripe } from '@/lib/billing/subscription/stripe-subscription-persist'
import { syncSubscriptionStateForUser } from '@/lib/billing/sync/passive-billing-sync'
import { invalidateBillingCache } from '@/lib/infra/cache'
import { toggleSubscriptionCancellation } from '@/lib/billing/subscription/toggle-cancellation'

const mockGetUserInfo = getCachedUserStripeInfo as ReturnType<typeof vi.fn>
const mockGetLiveState = getCachedLiveSubscriptionState as ReturnType<typeof vi.fn>
const mockSetCancel = setSubscriptionCancelAtPeriodEnd as ReturnType<typeof vi.fn>
const mockApplyAccess = applyLiveSubscriptionAccessFromStripe as ReturnType<typeof vi.fn>
const mockGetProAccess = getFreshVerifiedProAccess as ReturnType<typeof vi.fn>
const mockMarkPro = markFreshProAccessResolved as ReturnType<typeof vi.fn>
const mockSyncRecovery = syncSubscriptionStateForUser as ReturnType<typeof vi.fn>
const mockInvalidate = invalidateBillingCache as ReturnType<typeof vi.fn>

describe('toggleSubscriptionCancellation', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockGetUserInfo.mockResolvedValue({ stripeSubscriptionId: 'sub_1', stripeCustomerId: 'cus_1' })
    mockGetLiveState.mockResolvedValue({ status: 'active' })
    mockGetProAccess.mockResolvedValue(true)
  })

  it('throws and skips Stripe when the user has no active subscription', async () => {
    mockGetUserInfo.mockResolvedValue({ stripeSubscriptionId: null })

    await expect(toggleSubscriptionCancellation('user-1', true)).rejects.toThrow(
      'No active subscription found. Please contact support.',
    )
    expect(mockSetCancel).not.toHaveBeenCalled()
  })

  it('cancels, applies access, and invalidates the cache on success', async () => {
    await toggleSubscriptionCancellation('user-1', true)

    expect(mockSetCancel).toHaveBeenCalledWith('sub_1', true)
    expect(mockApplyAccess).toHaveBeenCalledWith('sub_1', { status: 'active' }, {
      userId: 'user-1',
      customerId: 'cus_1',
    })
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
