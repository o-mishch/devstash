import { beforeEach, describe, expect, it, vi } from 'vitest'

const mockLimit = vi.fn()
const mockGetRemaining = vi.fn()

vi.mock('@upstash/ratelimit', () => {
  // Regular function (not an arrow) so `new Ratelimit(...)` in getLimiters can construct it; the
  // static `slidingWindow` is required because getLimiters passes its result to the constructor.
  const Ratelimit = vi.fn(function () {
    return { limit: mockLimit, getRemaining: mockGetRemaining }
  }) as unknown as { (): unknown; slidingWindow: ReturnType<typeof vi.fn> }
  Ratelimit.slidingWindow = vi.fn(() => 'sliding-window')
  return { Ratelimit }
})

import { Ratelimit } from '@upstash/ratelimit'

// `vi.clearAllMocks()` in the beforeEach hooks wipes the constructor's implementation, so re-apply
// it (as a constructable regular function) before any test that needs a real built limiter — the
// read path in getAiUsage. The other describes pass via the fail-open fallback and don't need it.
function reapplyRatelimitImpl(): void {
  vi.mocked(Ratelimit).mockImplementation(function () {
    return { limit: mockLimit, getRemaining: mockGetRemaining } as unknown as Ratelimit
  })
}

vi.mock('@/lib/infra/redis', () => ({
  RATE_LIMIT_NS: 'devstash:test',
  getRedis: vi.fn(),
}))

import { getRedis } from '@/lib/infra/redis'
import {
  rateLimitAction,
  withRateLimit,
  resetRateLimitersForTests,
  getAiUsage,
  AI_RATE_LIMIT_KEYS,
} from '@/lib/infra/rate-limit'
import { AI_FEATURE_HOURLY_LIMIT } from '@/lib/utils/constants'

const mockGetRedis = getRedis as ReturnType<typeof vi.fn>

describe('rateLimitAction', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.unstubAllEnvs()
    resetRateLimitersForTests()
    mockGetRedis.mockReturnValue({})
    mockLimit.mockResolvedValue({ success: true, remaining: 9, reset: Date.now() + 60_000 })
  })

  it('allows requests when Redis is unavailable in development', async () => {
    vi.stubEnv('NODE_ENV', 'development')
    mockGetRedis.mockReturnValue(null)

    const result = await rateLimitAction('login', 'user-1')

    expect(result).toBeNull()
  })

  it('denies requests when Redis is unavailable in production for login', async () => {
    vi.stubEnv('NODE_ENV', 'production')
    mockGetRedis.mockReturnValue(null)

    const result = await rateLimitAction('login', 'user-1')

    expect(result?.success).toBe(false)
  })

  it('denies stripeSync when Redis is unavailable in production', async () => {
    vi.stubEnv('NODE_ENV', 'production')
    mockGetRedis.mockReturnValue(null)

    const result = await rateLimitAction('stripeSync', 'user-1')

    expect(result?.success).toBe(false)
  })

  it('denies when limit is exceeded with Redis available', async () => {
    vi.stubEnv('NODE_ENV', 'production')
    mockLimit.mockResolvedValue({ success: false, remaining: 0, reset: Date.now() + 120_000 })

    const result = await rateLimitAction('login', 'user-1')

    expect(result?.success).toBe(false)
    expect(result?.message).toMatch(/Too many attempts/)
  })
})

describe('getAiUsage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.unstubAllEnvs()
    resetRateLimitersForTests()
    mockGetRedis.mockReturnValue({})
    reapplyRatelimitImpl()
  })

  it('returns one entry per AI key with limit === AI_FEATURE_HOURLY_LIMIT', async () => {
    const reset = Date.now() + 30 * 60_000
    mockGetRemaining.mockResolvedValue({ remaining: 7, reset, limit: AI_FEATURE_HOURLY_LIMIT })

    const usage = await getAiUsage('user-1')

    expect(usage).toHaveLength(AI_RATE_LIMIT_KEYS.length)
    expect(usage.map((u) => u.key)).toEqual([...AI_RATE_LIMIT_KEYS])
    for (const entry of usage) {
      expect(entry.limit).toBe(AI_FEATURE_HOURLY_LIMIT)
      expect(entry.remaining).toBe(7)
      expect(entry.resetAt).toBe(reset)
    }
    expect(mockGetRemaining).toHaveBeenCalledTimes(AI_RATE_LIMIT_KEYS.length)
    expect(mockGetRemaining).toHaveBeenCalledWith('user-1')
    // The meter must NEVER consume a token — `limit()`/`check()` are the consuming calls and must
    // stay untouched on the read path.
    expect(mockLimit).not.toHaveBeenCalled()
  })

  it('fails open with full budget when limiters are unavailable', async () => {
    mockGetRedis.mockReturnValue(null)

    const usage = await getAiUsage('user-1')

    expect(usage).toHaveLength(AI_RATE_LIMIT_KEYS.length)
    for (const entry of usage) {
      expect(entry.remaining).toBe(AI_FEATURE_HOURLY_LIMIT)
      expect(entry.limit).toBe(AI_FEATURE_HOURLY_LIMIT)
      expect(entry.resetAt).toBe(0)
    }
    expect(mockGetRemaining).not.toHaveBeenCalled()
  })

  it('fails open with full budget when a read throws', async () => {
    mockGetRemaining.mockRejectedValue(new Error('redis down'))

    const usage = await getAiUsage('user-1')

    expect(usage.every((u) => u.remaining === AI_FEATURE_HOURLY_LIMIT && u.resetAt === 0)).toBe(true)
  })
})

describe('withRateLimit', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.unstubAllEnvs()
    resetRateLimitersForTests()
    mockGetRedis.mockReturnValue({})
    mockLimit.mockResolvedValue({ success: true, remaining: 9, reset: Date.now() + 60_000 })
  })

  it('calls fn and returns its result when allowed', async () => {
    const fn = vi.fn().mockResolvedValue({ success: true })

    const result = await withRateLimit('login', fn)

    expect(fn).toHaveBeenCalledOnce()
    expect(result).toEqual({ success: true })
  })

  it('returns denied ActionState without calling fn when rate limited', async () => {
    vi.stubEnv('NODE_ENV', 'production')
    mockLimit.mockResolvedValue({ success: false, remaining: 0, reset: Date.now() + 60_000 })
    const fn = vi.fn()

    const result = await withRateLimit('login', fn)

    expect(fn).not.toHaveBeenCalled()
    expect(result.success).toBe(false)
    expect(result.message).toMatch(/Too many attempts/)
  })
})
