import { beforeEach, describe, expect, it, vi } from 'vitest'

// Vercel backend: @upstash/ratelimit over the Upstash REST client. The library + getRedis are
// mocked; the tests assert limiter construction (slidingWindow config + prefix), the consume/read
// mapping, batching, reset, and that an unavailable Redis rejects (so the dispatcher fails open/closed).
// vi.hoisted so the mock factory (hoisted to the top) can reference these method stubs. The
// constructor impl lives in the factory so `new Ratelimit()` always yields the stub, regardless of
// static vs dynamic import; per-test we only reset call history (never clearAllMocks, which would
// wipe the factory impl).
const { mockLimit, mockGetRemaining, mockResetUsedTokens } = vi.hoisted(() => ({
  mockLimit: vi.fn(),
  mockGetRemaining: vi.fn(),
  mockResetUsedTokens: vi.fn(),
}))

vi.mock('@upstash/ratelimit', () => {
  const Ratelimit = vi.fn(function () {
    return { limit: mockLimit, getRemaining: mockGetRemaining, resetUsedTokens: mockResetUsedTokens }
  }) as unknown as { (): unknown; slidingWindow: ReturnType<typeof vi.fn> }
  Ratelimit.slidingWindow = vi.fn(() => 'sliding-window')
  return { Ratelimit }
})
vi.mock('@/lib/infra/redis', () => ({ getRedis: vi.fn(() => ({})) }))

import { Ratelimit } from '@upstash/ratelimit'
import { getRedis } from '@/lib/infra/redis'
import { upstashRateLimit, resetUpstashLimitersForTests } from '@/lib/infra/rate-limit-upstash'

const mockGetRedis = getRedis as ReturnType<typeof vi.fn>

beforeEach(() => {
  resetUpstashLimitersForTests()
  mockGetRedis.mockReturnValue({})
  mockLimit.mockReset()
  mockGetRemaining.mockReset()
  mockResetUsedTokens.mockReset()
  vi.mocked(Ratelimit).mockClear()
  vi.mocked(Ratelimit.slidingWindow).mockClear()
})

describe('upstashRateLimit.check', () => {
  it('builds a slidingWindow limiter with the right prefix and maps the result', async () => {
    const reset = Date.now() + 60_000
    mockLimit.mockResolvedValue({ success: true, remaining: 4, reset })

    const result = await upstashRateLimit.check('login', 'u1', { attempts: 5, window: '15 m' })

    expect(result.success).toBe(true)
    expect(result.remaining).toBe(4)
    expect(result.retryAfter).toBeGreaterThanOrEqual(0)
    expect(Ratelimit.slidingWindow).toHaveBeenCalledWith(5, '15 m')
    expect(vi.mocked(Ratelimit)).toHaveBeenCalledWith(expect.objectContaining({ prefix: 'rl:login' }))
    expect(mockLimit).toHaveBeenCalledWith('u1')
  })

  it('rejects when Redis is unavailable (dispatcher then fails open/closed)', async () => {
    mockGetRedis.mockReturnValue(null)
    await expect(upstashRateLimit.check('login', 'u1', { attempts: 5, window: '15 m' })).rejects.toThrow()
  })
})

describe('upstashRateLimit.getRemainingMany', () => {
  it('maps a single read (one-element batch)', async () => {
    const reset = Date.now() + 3_600_000
    mockGetRemaining.mockResolvedValue({ remaining: 0, reset })
    const [res] = await upstashRateLimit.getRemainingMany([
      { key: 'aiBrainDump', identifier: 'u1', config: { attempts: 1, window: '1 h' } },
    ])
    expect(res).toEqual({ remaining: 0, resetAt: reset })
    expect(mockLimit).not.toHaveBeenCalled()
  })

  it('reads every request non-consumingly in one batch', async () => {
    const reset = Date.now() + 30 * 60_000
    mockGetRemaining.mockResolvedValue({ remaining: 7, reset })
    const results = await upstashRateLimit.getRemainingMany([
      { key: 'aiTags', identifier: 'u1', config: { attempts: 50, window: '1 h' } },
      { key: 'aiExplain', identifier: 'u1', config: { attempts: 50, window: '1 h' } },
    ])
    expect(results).toEqual([
      { remaining: 7, resetAt: reset },
      { remaining: 7, resetAt: reset },
    ])
    expect(mockGetRemaining).toHaveBeenCalledTimes(2)
    expect(mockLimit).not.toHaveBeenCalled()
  })
})

describe('upstashRateLimit.reset', () => {
  it('zeroes the window via resetUsedTokens', async () => {
    mockResetUsedTokens.mockResolvedValue(undefined)
    await upstashRateLimit.reset('aiBrainDump', 'u1', { attempts: 1, window: '1 h' })
    expect(mockResetUsedTokens).toHaveBeenCalledWith('u1')
  })
})
