import { beforeEach, describe, expect, it, vi } from 'vitest'

const reactCacheStore = new Map<string, unknown>()

const {
  mockGetCachedLiveSubscriptionState,
  mockGetCachedUserStripeInfo,
  mockReadProAccessCache,
  mockWriteProAccessCache,
} = vi.hoisted(() => ({
  mockGetCachedLiveSubscriptionState: vi.fn(),
  mockGetCachedUserStripeInfo: vi.fn(),
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

vi.mock('@/lib/billing/sync/user-billing-state', () => ({
  getCachedUserStripeInfo: mockGetCachedUserStripeInfo,
  getFreshUserStripeInfo: vi.fn(),
  getCachedLiveSubscriptionState: mockGetCachedLiveSubscriptionState,
}))

vi.mock('@/lib/billing/access/pro-access-cache', () => ({
  readProAccessCache: mockReadProAccessCache,
  writeProAccessCache: mockWriteProAccessCache,
  PRO_ACCESS_OUTAGE_DENY_TTL_SECONDS: 30,
}))

vi.mock('@/lib/infra/logger', () => ({
  createLogger: () => ({ error: vi.fn(), info: vi.fn(), warn: vi.fn() }),
}))

vi.unmock('@/lib/billing/access/pro-access-resolution')

import { resolveSessionUserIsPro } from '@/lib/billing/access/pro-access-resolution'

beforeEach(() => {
  reactCacheStore.clear()
  vi.clearAllMocks()
  mockReadProAccessCache.mockResolvedValue(true)
  mockGetCachedUserStripeInfo.mockResolvedValue({
    stripeSubscriptionId: 'sub_1',
    isPro: true,
    currentPeriodEnd: new Date('2026-07-01T00:00:00.000Z'),
    proExpiredAt: null,
    lastStripeSyncAt: new Date('2026-06-08T10:00:00.000Z'),
  })
  mockGetCachedLiveSubscriptionState.mockResolvedValue({
    exists: true,
    status: 'active',
  })
})

describe('resolveSessionUserIsPro', () => {
  it('returns cached Pro access when resolution succeeds', async () => {
    await expect(resolveSessionUserIsPro('user-1')).resolves.toBe(true)
  })

  it('returns false when Pro resolution throws', async () => {
    mockReadProAccessCache.mockRejectedValue(new Error('Redis unavailable'))

    await expect(resolveSessionUserIsPro('user-1')).resolves.toBe(false)
  })
})
