import { beforeEach, describe, expect, it, vi } from 'vitest'

// Self-hosted backend: rate-limiter-flexible over the raw node-redis client. Both are mocked; the
// tests assert limiter construction (keyPrefix/points/duration), the consume→result mapping, the
// store-error-vs-rate-limited distinction, and the non-consuming read. vi.hoisted so the mock
// factory can reference these stubs; the constructor impl lives in the factory so `new
// RateLimiterRedis()` always yields the stub. Per-test we only reset call history.
const { mockConsume, mockGet, mockDelete } = vi.hoisted(() => ({
  mockConsume: vi.fn(),
  mockGet: vi.fn(),
  mockDelete: vi.fn(),
}))

vi.mock('rate-limiter-flexible', () => ({
  RateLimiterRedis: vi.fn(function () {
    return { consume: mockConsume, get: mockGet, delete: mockDelete }
  }),
}))
vi.mock('@/lib/infra/redis-tcp', () => ({ getTcpRedisClient: vi.fn(async () => ({})) }))

import { RateLimiterRedis } from 'rate-limiter-flexible'
import { tcpRateLimit, resetTcpLimitersForTests } from '@/lib/infra/rate-limit-tcp'

beforeEach(() => {
  resetTcpLimitersForTests()
  mockConsume.mockReset()
  mockGet.mockReset()
  mockDelete.mockReset()
  vi.mocked(RateLimiterRedis).mockClear()
})

describe('tcpRateLimit.check', () => {
  it('constructs the limiter with the mapped keyPrefix/points/duration and allows on consume', async () => {
    mockConsume.mockResolvedValue({ remainingPoints: 4, msBeforeNext: 0 })

    const result = await tcpRateLimit.check('login', 'u1', { attempts: 5, window: '15 m' })

    expect(result).toEqual({ success: true, remaining: 4, retryAfter: 0 })
    expect(mockConsume).toHaveBeenCalledWith('u1')
    expect(vi.mocked(RateLimiterRedis)).toHaveBeenCalledWith(
      expect.objectContaining({ keyPrefix: 'rl:login', points: 5, duration: 900, useRedisPackage: true }),
    )
  })

  it('denies (no throw) when consume rejects with a RateLimiterRes', async () => {
    mockConsume.mockRejectedValue({ msBeforeNext: 120_000, remainingPoints: 0 }) // not an Error → rate limited
    const result = await tcpRateLimit.check('login', 'u1', { attempts: 5, window: '15 m' })
    expect(result).toEqual({ success: false, remaining: 0, retryAfter: 120 })
  })

  it('rethrows a store Error so the caller applies its fail-open/closed policy', async () => {
    mockConsume.mockRejectedValue(new Error('redis down'))
    await expect(tcpRateLimit.check('login', 'u1', { attempts: 5, window: '15 m' })).rejects.toThrow('redis down')
  })
})

describe('tcpRateLimit window → duration mapping', () => {
  // The one piece of custom arithmetic in this backend: window string → integer seconds.
  it.each([
    ['1 h', 3600],
    ['1 d', 86400],
    ['30 s', 30],
    ['200 ms', 1], // sub-second clamps to 1s — never 0 (which would mean a permanent counter)
  ] as const)('constructs duration %s → %i seconds', async (window, duration) => {
    mockConsume.mockResolvedValue({ remainingPoints: 1, msBeforeNext: 0 })
    await tcpRateLimit.check('login', 'u1', { attempts: 5, window })
    expect(vi.mocked(RateLimiterRedis)).toHaveBeenCalledWith(expect.objectContaining({ duration }))
  })
})

describe('tcpRateLimit.getRemainingMany', () => {
  it('returns full budget when get() finds no window', async () => {
    mockGet.mockResolvedValue(null)
    const [res] = await tcpRateLimit.getRemainingMany([{ key: 'aiTags', identifier: 'u1', config: { attempts: 50, window: '1 h' } }])
    expect(res).toEqual({ remaining: 50, resetAt: 0 })
  })

  it('maps remainingPoints/msBeforeNext without consuming', async () => {
    mockGet.mockResolvedValue({ remainingPoints: 7, msBeforeNext: 1_000 })
    const [res] = await tcpRateLimit.getRemainingMany([{ key: 'aiTags', identifier: 'u1', config: { attempts: 50, window: '1 h' } }])
    expect(res.remaining).toBe(7)
    expect(res.resetAt).toBeGreaterThan(Date.now())
    expect(mockConsume).not.toHaveBeenCalled()
  })
})

describe('tcpRateLimit.reset / caching', () => {
  it('deletes the key', async () => {
    mockDelete.mockResolvedValue(true)
    await tcpRateLimit.reset('aiBrainDump', 'u1', { attempts: 1, window: '1 h' })
    expect(mockDelete).toHaveBeenCalledWith('u1')
  })

  it('constructs one limiter per key across calls', async () => {
    mockConsume.mockResolvedValue({ remainingPoints: 1, msBeforeNext: 0 })
    await tcpRateLimit.check('login', 'a', { attempts: 5, window: '15 m' })
    await tcpRateLimit.check('login', 'b', { attempts: 5, window: '15 m' })
    expect(vi.mocked(RateLimiterRedis)).toHaveBeenCalledTimes(1)
  })
})
