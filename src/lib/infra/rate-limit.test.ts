import { beforeEach, describe, expect, it, vi } from 'vitest'

const mockLimit = vi.fn()
const mockGetRemaining = vi.fn()
const mockResetUsedTokens = vi.fn()

vi.mock('@upstash/ratelimit', () => {
  // Regular function (not an arrow) so `new Ratelimit(...)` in getLimiters can construct it; the
  // static `slidingWindow` is required because getLimiters passes its result to the constructor.
  const Ratelimit = vi.fn(function () {
    return { limit: mockLimit, getRemaining: mockGetRemaining, resetUsedTokens: mockResetUsedTokens }
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
    return { limit: mockLimit, getRemaining: mockGetRemaining, resetUsedTokens: mockResetUsedTokens } as unknown as Ratelimit
  })
}

vi.mock('@/lib/infra/redis', () => ({
  RATE_LIMIT_NS: 'devstash:test',
  getRedis: vi.fn(),
  isTcpRedis: vi.fn(() => false),
}))

import { getRedis, isTcpRedis } from '@/lib/infra/redis'
import {
  rateLimitAction,
  withRateLimit,
  resetRateLimitersForTests,
  resetRateLimit,
  getAiUsage,
  getBrainDumpUsage,
  AI_RATE_LIMIT_KEYS,
} from '@/lib/infra/rate-limit'
import { AI_FEATURE_HOURLY_LIMIT } from '@/lib/utils/constants'

const mockGetRedis = getRedis as ReturnType<typeof vi.fn>
const mockIsTcpRedis = isTcpRedis as ReturnType<typeof vi.fn>

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

describe('aiSplitFile rate-limit config', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.unstubAllEnvs()
    resetRateLimitersForTests()
    mockGetRedis.mockReturnValue({})
    reapplyRatelimitImpl()
    mockLimit.mockResolvedValue({ success: true, remaining: 0, reset: Date.now() + 3_600_000 })
  })

  it('registers aiBrainDump as 1 attempt per hour (the only attempts:1 bucket)', async () => {
    // Building the limiters runs slidingWindow(attempts, window) for every key; assert the split key.
    await rateLimitAction('aiBrainDump', 'user-1')
    expect(Ratelimit.slidingWindow).toHaveBeenCalledWith(1, '1 h')
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

// The Brain Dump quota is surfaced separately from the four per-feature meters (it is NOT in
// AI_RATE_LIMIT_KEYS); its read must also never consume the 1/hr token and must fail open.
describe('getBrainDumpUsage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.unstubAllEnvs()
    resetRateLimitersForTests()
    mockGetRedis.mockReturnValue({})
    reapplyRatelimitImpl()
  })

  it('reads the aiBrainDump budget non-consumingly (1/hr) via getRemaining', async () => {
    const reset = Date.now() + 3_600_000
    mockGetRemaining.mockResolvedValue({ remaining: 0, reset })

    const usage = await getBrainDumpUsage('user-1')

    expect(usage.key).toBe('aiBrainDump')
    expect(usage.limit).toBe(1) // the only attempts:1 bucket
    expect(usage.remaining).toBe(0)
    expect(usage.resetAt).toBe(reset)
    expect(mockGetRemaining).toHaveBeenCalledWith('user-1')
    // Must NEVER spend the token — `limit()` is the consuming call and stays untouched on the read path.
    expect(mockLimit).not.toHaveBeenCalled()
  })

  it('fails open with full budget when limiters are unavailable', async () => {
    mockGetRedis.mockReturnValue(null)

    const usage = await getBrainDumpUsage('user-1')

    expect(usage).toEqual({ key: 'aiBrainDump', limit: 1, remaining: 1, resetAt: 0 })
    expect(mockGetRemaining).not.toHaveBeenCalled()
  })

  it('fails open with full budget when the read throws', async () => {
    mockGetRemaining.mockRejectedValue(new Error('redis down'))

    const usage = await getBrainDumpUsage('user-1')

    expect(usage).toEqual({ key: 'aiBrainDump', limit: 1, remaining: 1, resetAt: 0 })
  })
})

describe('resetRateLimit', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetRateLimitersForTests()
    reapplyRatelimitImpl()
    mockGetRedis.mockReturnValue({})
    mockResetUsedTokens.mockResolvedValue(undefined)
  })

  it('calls resetUsedTokens on the keyed limiter', async () => {
    await resetRateLimit('aiBrainDump', 'user-1')
    expect(mockResetUsedTokens).toHaveBeenCalledWith('user-1')
  })
})

// Native TCP backend (ioredis → Memorystore / local Redis). isTcpRedis() flips the
// limiter to the Lua sliding-window path; @upstash/ratelimit is never constructed.
describe('rate-limit TCP (ioredis) backend', () => {
  const mockEval = vi.fn()
  const mockDel = vi.fn()

  beforeEach(() => {
    vi.clearAllMocks()
    vi.unstubAllEnvs()
    resetRateLimitersForTests()
    mockIsTcpRedis.mockReturnValue(true)
    mockGetRedis.mockReturnValue({ eval: mockEval, del: mockDel })
  })

  it('allows when the Lua script returns success', async () => {
    mockEval.mockResolvedValue([1, 4, Date.now() + 60_000])
    const result = await rateLimitAction('login', 'user-1')
    expect(result).toBeNull()
    expect(mockEval).toHaveBeenCalledOnce()
    // bucket key uses the shared rl namespace + action + identifier
    expect(mockEval.mock.calls[0][1]).toEqual(['devstash:test:login:user-1'])
  })

  it('denies when the Lua script returns failure', async () => {
    vi.stubEnv('NODE_ENV', 'production')
    mockEval.mockResolvedValue([0, 0, Date.now() + 120_000])
    const result = await rateLimitAction('login', 'user-1')
    expect(result?.success).toBe(false)
    expect(result?.message).toMatch(/Too many attempts/)
  })

  it('fails open in development when eval throws', async () => {
    vi.stubEnv('NODE_ENV', 'development')
    mockEval.mockRejectedValue(new Error('redis down'))
    const result = await rateLimitAction('login', 'user-1')
    expect(result).toBeNull()
  })

  it('resetRateLimit deletes the bucket key', async () => {
    mockDel.mockResolvedValue(1)
    await resetRateLimit('aiBrainDump', 'user-1')
    expect(mockDel).toHaveBeenCalledWith('devstash:test:aiBrainDump:user-1')
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
