import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { LogFn } from 'pino'
import type { getUserStripeInfo } from '@/lib/db/stripe'

const reactCacheStore = new Map<string, unknown>()

const { mockGetCachedUserStripeInfo } = vi.hoisted(() => ({
  mockGetCachedUserStripeInfo: vi.fn<typeof getUserStripeInfo>(),
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
  getFreshUserStripeInfo: vi.fn<typeof getUserStripeInfo>(),
}))

vi.mock('@/lib/infra/pino', () => ({
  logger: { child: () => ({ error: vi.fn<LogFn>(), info: vi.fn<LogFn>(), warn: vi.fn<LogFn>() }) },
}))

vi.unmock('@/lib/billing/access/pro-access-resolution')

import { resolveSessionUserIsPro } from '@/lib/billing/access/pro-access-resolution'

beforeEach(() => {
  reactCacheStore.clear()
  vi.clearAllMocks()
  mockGetCachedUserStripeInfo.mockResolvedValue({
    stripeSubscriptionId: 'sub_1',
    isPro: true,
    stripeCurrentPeriodEnd: new Date('2026-07-01T00:00:00.000Z'),
    proExpiredAt: null,
    stripeLastSyncAt: new Date('2026-06-08T10:00:00.000Z'),
  })
})

describe('resolveSessionUserIsPro', () => {
  it('returns cached Pro access when resolution succeeds', async () => {
    await expect(resolveSessionUserIsPro('user-1')).resolves.toBe(true)
  })

  it('returns false when Pro resolution throws', async () => {
    mockGetCachedUserStripeInfo.mockRejectedValue(new Error('DB unavailable'))

    await expect(resolveSessionUserIsPro('user-1')).resolves.toBe(false)
  })
})
