import { beforeEach, describe, expect, it, vi } from 'vitest'

const reactCacheStore = new Map<string, unknown>()

const {
  mockGetCachedUserStripeInfo,
  mockGetFreshUserStripeInfo,
} = vi.hoisted(() => ({
  mockGetCachedUserStripeInfo: vi.fn(),
  mockGetFreshUserStripeInfo: vi.fn(),
}))

vi.mock('react', () => ({
  cache: (fn: (...args: unknown[]) => unknown) => {
    return (...args: unknown[]) => {
      const key = `${String(fn)}:${JSON.stringify(args)}`
      if (!reactCacheStore.has(key)) {
        reactCacheStore.set(key, fn(...args))
      }
      return reactCacheStore.get(key)
    }
  },
}))

vi.mock('@/lib/billing/sync/user-billing-state', () => ({
  getCachedUserStripeInfo: mockGetCachedUserStripeInfo,
  getFreshUserStripeInfo: mockGetFreshUserStripeInfo,
}))

vi.mock('@/lib/infra/pino', () => ({
  logger: { child: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() }) },
}))

vi.unmock('@/lib/billing/access/pro-access-resolution')

import {
  clearBillingRequestScopeForTests,
  getCachedVerifiedProAccess,
  getFreshVerifiedProAccess,
  getStoredFreshProAccess,
  markFreshProAccessResolved,
  resolveProAccessBypassingCache,
  resolveProAccessForBillingContext,
  resolveProAccessFromRow,
} from './pro-access-resolution'

const baseStripeRow = {
  email: 'user@example.com',
  stripeCustomerId: 'cus_1',
  stripeSubscriptionId: 'sub_1',
  isPro: true,
  stripeSubscriptionStart: new Date('2026-01-01T00:00:00.000Z'),
  stripeCurrentPeriodEnd: new Date('2026-07-01T00:00:00.000Z'),
  stripeSubscriptionInterval: 'month' as const,
  stripeCancelAtPeriodEnd: false,
  stripeLastSyncAt: new Date('2026-06-08T10:00:00.000Z'),
  proExpiredAt: null,
}

describe('pro-access-resolution', () => {
  beforeEach(() => {
    reactCacheStore.clear()
    vi.clearAllMocks()
    clearBillingRequestScopeForTests()
    mockGetCachedUserStripeInfo.mockResolvedValue(baseStripeRow)
    mockGetFreshUserStripeInfo.mockResolvedValue(baseStripeRow)
  })

  it('returns isPro from DB when subscription is linked', async () => {
    await expect(resolveProAccessBypassingCache('user-1')).resolves.toBe(true)
  })

  it('returns false when DB isPro is false', async () => {
    mockGetFreshUserStripeInfo.mockResolvedValue({ ...baseStripeRow, isPro: false })

    await expect(resolveProAccessBypassingCache('user-1')).resolves.toBe(false)
  })

  it('returns false when no subscription is linked', async () => {
    mockGetFreshUserStripeInfo.mockResolvedValue({
      ...baseStripeRow,
      stripeSubscriptionId: null,
      isPro: true,
    })

    await expect(resolveProAccessBypassingCache('user-1')).resolves.toBe(false)
  })

  it('resolves Pro from a fresh Stripe row after a billing write in the same request', async () => {
    mockGetCachedUserStripeInfo.mockResolvedValue({
      ...baseStripeRow,
      stripeSubscriptionId: null,
      isPro: false,
    })
    mockGetFreshUserStripeInfo.mockResolvedValue(baseStripeRow)

    await expect(getCachedVerifiedProAccess('user-1')).resolves.toBe(false)
    await expect(getFreshVerifiedProAccess('user-1')).resolves.toBe(true)
    expect(mockGetFreshUserStripeInfo).toHaveBeenCalledWith('user-1')
  })
})

describe('resolveProAccessForBillingContext', () => {
  beforeEach(() => {
    reactCacheStore.clear()
    vi.clearAllMocks()
    clearBillingRequestScopeForTests()
    mockGetCachedUserStripeInfo.mockResolvedValue(baseStripeRow)
    mockGetFreshUserStripeInfo.mockResolvedValue(baseStripeRow)
  })

  it('uses cached Pro access when fresh billing context is not requested', async () => {
    await expect(resolveProAccessForBillingContext('user-1')).resolves.toBe(true)
    expect(mockGetFreshUserStripeInfo).not.toHaveBeenCalled()
  })

  it('reuses the stored fresh Pro result when layout already resolved entitlements', async () => {
    markFreshProAccessResolved('user-1', true)

    await expect(resolveProAccessForBillingContext('user-1', { freshBillingContext: true })).resolves.toBe(true)
    expect(mockGetFreshUserStripeInfo).not.toHaveBeenCalled()
  })

  it('reads fresh Pro access when billing context requires it and layout has not resolved yet', async () => {
    await expect(resolveProAccessForBillingContext('user-1', { freshBillingContext: true })).resolves.toBe(true)
    expect(mockGetFreshUserStripeInfo).toHaveBeenCalledWith('user-1')
  })
})

describe('resolveProAccessFromRow', () => {
  it('grants Pro when isPro is true and a subscription is linked', () => {
    expect(resolveProAccessFromRow('user-1', { isPro: true, stripeSubscriptionId: 'sub_1' })).toBe(true)
  })

  it('denies Pro when isPro is false', () => {
    expect(resolveProAccessFromRow('user-1', { isPro: false, stripeSubscriptionId: 'sub_1' })).toBe(false)
  })

  it('denies Pro (fail closed) when isPro is true but no subscription is linked', () => {
    expect(resolveProAccessFromRow('user-1', { isPro: true, stripeSubscriptionId: null })).toBe(false)
  })

  it('denies Pro when neither isPro nor a subscription is present', () => {
    expect(resolveProAccessFromRow('user-1', { isPro: false, stripeSubscriptionId: null })).toBe(false)
  })
})

describe('pro-access-resolution request scope', () => {
  it('stores and reads fresh Pro access per user within a request', () => {
    reactCacheStore.clear()
    clearBillingRequestScopeForTests()
    expect(getStoredFreshProAccess('user-1')).toBeNull()

    markFreshProAccessResolved('user-1', true)
    expect(getStoredFreshProAccess('user-1')).toBe(true)
    expect(getStoredFreshProAccess('user-2')).toBeNull()
  })
})
