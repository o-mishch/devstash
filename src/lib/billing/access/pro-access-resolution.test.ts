import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const reactCacheStore = new Map<string, unknown>()

const {
  mockFetchLiveSubscriptionState,
  mockGetCachedLiveSubscriptionState,
  mockGetCachedUserStripeInfo,
  mockGetFreshUserStripeInfo,
  mockReadProAccessCache,
  mockWriteProAccessCache,
} = vi.hoisted(() => ({
  mockFetchLiveSubscriptionState: vi.fn(),
  mockGetCachedLiveSubscriptionState: vi.fn(),
  mockGetCachedUserStripeInfo: vi.fn(),
  mockGetFreshUserStripeInfo: vi.fn(),
  mockReadProAccessCache: vi.fn(),
  mockWriteProAccessCache: vi.fn(),
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

vi.mock('@/lib/billing/stripe-api', () => ({
  fetchLiveSubscriptionState: mockFetchLiveSubscriptionState,
}))

vi.mock('@/lib/billing/sync/user-billing-state', () => ({
  getCachedUserStripeInfo: mockGetCachedUserStripeInfo,
  getFreshUserStripeInfo: mockGetFreshUserStripeInfo,
  getCachedLiveSubscriptionState: mockGetCachedLiveSubscriptionState,
}))

vi.mock('@/lib/billing/access/pro-access-cache', () => ({
  readProAccessCache: mockReadProAccessCache,
  writeProAccessCache: mockWriteProAccessCache,
  PRO_ACCESS_OUTAGE_DENY_TTL_SECONDS: 30,
}))

vi.mock('@/lib/infra/logger', () => ({
  createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() }),
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
} from './pro-access-resolution'

const recentSync = new Date('2026-06-08T10:00:00.000Z')
const futurePeriodEnd = new Date('2026-07-01T00:00:00.000Z')

const baseStripeRow = {
  email: 'user@example.com',
  stripeCustomerId: 'cus_1',
  stripeSubscriptionId: 'sub_1',
  isPro: true,
  subscriptionStart: new Date('2026-01-01T00:00:00.000Z'),
  currentPeriodEnd: futurePeriodEnd,
  subscriptionInterval: 'month' as const,
  cancelAtPeriodEnd: false,
  lastStripeSyncAt: recentSync,
  proExpiredAt: null,
}

const activeLiveState = {
  exists: true,
  status: 'active' as const,
  cancelAtPeriodEnd: false,
  currentPeriodEnd: futurePeriodEnd,
  interval: 'month' as const,
}

describe('pro-access-resolution', () => {
  beforeEach(() => {
    reactCacheStore.clear()
    vi.clearAllMocks()
    clearBillingRequestScopeForTests()
    mockReadProAccessCache.mockResolvedValue(null)
    mockWriteProAccessCache.mockResolvedValue(undefined)
    mockGetCachedUserStripeInfo.mockResolvedValue(baseStripeRow)
    mockGetFreshUserStripeInfo.mockResolvedValue(baseStripeRow)
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-06-08T12:00:00.000Z'))
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('returns true when live Stripe reports an entitled subscription status', async () => {
    mockGetCachedLiveSubscriptionState.mockResolvedValue(activeLiveState)

    await expect(resolveProAccessBypassingCache('user-1')).resolves.toBe(true)
    expect(mockReadProAccessCache).not.toHaveBeenCalled()
    expect(mockWriteProAccessCache).toHaveBeenCalledWith('user-1', true)
  })

  it('returns false when live Stripe reports unpaid even if DB isPro is true', async () => {
    mockGetCachedLiveSubscriptionState.mockResolvedValue({
      ...activeLiveState,
      status: 'unpaid',
    })

    await expect(resolveProAccessBypassingCache('user-1')).resolves.toBe(false)
    expect(mockWriteProAccessCache).toHaveBeenCalledWith('user-1', false)
  })

  it('denies Pro when there is no linked subscription id', async () => {
    mockGetCachedUserStripeInfo.mockResolvedValue({
      ...baseStripeRow,
      stripeSubscriptionId: null,
      isPro: true,
    })

    await expect(resolveProAccessBypassingCache('user-1')).resolves.toBe(false)
    expect(mockFetchLiveSubscriptionState).not.toHaveBeenCalled()
  })

  it('trusts recent DB sync during Stripe outages when period has not ended', async () => {
    mockGetCachedLiveSubscriptionState.mockResolvedValue(null)

    await expect(resolveProAccessBypassingCache('user-1')).resolves.toBe(true)
    expect(mockWriteProAccessCache).toHaveBeenCalledWith('user-1', true)
  })

  it('grants Pro during outages when isPro is true without a stored period end', async () => {
    mockGetCachedLiveSubscriptionState.mockResolvedValue(null)
    mockGetCachedUserStripeInfo.mockResolvedValue({
      ...baseStripeRow,
      currentPeriodEnd: null,
      lastStripeSyncAt: new Date('2026-01-01T00:00:00.000Z'),
    })

    await expect(resolveProAccessBypassingCache('user-1')).resolves.toBe(true)
    expect(mockWriteProAccessCache).toHaveBeenCalledWith('user-1', true)
  })

  it('denies Pro during outages when the cached period has expired and caches denial briefly', async () => {
    mockGetCachedLiveSubscriptionState.mockResolvedValue(null)
    mockGetCachedUserStripeInfo.mockResolvedValue({
      ...baseStripeRow,
      currentPeriodEnd: new Date('2026-06-01T00:00:00.000Z'),
    })

    await expect(resolveProAccessBypassingCache('user-1')).resolves.toBe(false)
    expect(mockWriteProAccessCache).toHaveBeenCalledWith('user-1', false, 30)
  })

  it('denies Pro during outages when proExpiredAt from a prior cancellation is still set', async () => {
    mockGetCachedLiveSubscriptionState.mockResolvedValue(null)
    mockGetCachedUserStripeInfo.mockResolvedValue({
      ...baseStripeRow,
      proExpiredAt: new Date('2026-06-01T00:00:00.000Z'),
    })

    await expect(resolveProAccessBypassingCache('user-1')).resolves.toBe(false)
    expect(mockWriteProAccessCache).toHaveBeenCalledWith('user-1', false, 30)
  })

  it('reads Redis cache before hitting Stripe', async () => {
    mockReadProAccessCache.mockResolvedValue(true)

    await expect(getCachedVerifiedProAccess('user-1')).resolves.toBe(true)
    expect(mockGetCachedLiveSubscriptionState).not.toHaveBeenCalled()
    expect(mockGetCachedUserStripeInfo).not.toHaveBeenCalled()
  })

  it('resolves Pro from a fresh Stripe row after a billing write in the same request', async () => {
    mockGetCachedUserStripeInfo.mockResolvedValue({
      ...baseStripeRow,
      stripeSubscriptionId: null,
      isPro: false,
    })
    mockGetFreshUserStripeInfo.mockResolvedValue(baseStripeRow)
    mockGetCachedLiveSubscriptionState.mockResolvedValue(activeLiveState)

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
    mockReadProAccessCache.mockResolvedValue(null)
    mockGetCachedUserStripeInfo.mockResolvedValue(baseStripeRow)
    mockGetCachedLiveSubscriptionState.mockResolvedValue(activeLiveState)
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
    mockGetFreshUserStripeInfo.mockResolvedValue(baseStripeRow)

    await expect(resolveProAccessForBillingContext('user-1', { freshBillingContext: true })).resolves.toBe(true)
    expect(mockGetFreshUserStripeInfo).toHaveBeenCalledWith('user-1')
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
