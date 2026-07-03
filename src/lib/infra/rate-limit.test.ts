import { beforeEach, describe, expect, it, vi } from 'vitest'

// Dispatcher tests: rate-limit.ts selects a backend by isTcpRedis() and owns the fail-open/closed
// policy + AI-usage mapping. Both backends are mocked here; their real behavior is covered in
// rate-limit-upstash.test.ts and rate-limit-tcp.test.ts. vi.hoisted so the mock factories (hoisted
// above the file) can reference these stubs.
const { upstash, tcp } = vi.hoisted(() => ({
  upstash: { check: vi.fn(), getRemainingMany: vi.fn(), reset: vi.fn() },
  tcp: { check: vi.fn(), getRemainingMany: vi.fn(), reset: vi.fn() },
}))

vi.mock('@/lib/infra/rate-limit-upstash', () => ({
  upstashRateLimit: upstash,
  resetUpstashLimitersForTests: vi.fn(),
}))
vi.mock('@/lib/infra/rate-limit-tcp', () => ({
  tcpRateLimit: tcp,
  resetTcpLimitersForTests: vi.fn(),
}))
vi.mock('@/lib/infra/redis', () => ({ isTcpRedis: vi.fn(() => false) }))

import { isTcpRedis } from '@/lib/infra/redis'
import {
  rateLimitAction,
  withRateLimit,
  checkRateLimit,
  resetRateLimitersForTests,
  resetRateLimit,
  deniedMessage,
  getAiUsage,
  getBrainDumpUsage,
  AI_RATE_LIMIT_KEYS,
} from '@/lib/infra/rate-limit'
import { AI_FEATURE_HOURLY_LIMIT } from '@/lib/utils/constants'

const mockIsTcp = isTcpRedis as ReturnType<typeof vi.fn>

beforeEach(() => {
  vi.clearAllMocks()
  vi.unstubAllEnvs()
  resetRateLimitersForTests()
  mockIsTcp.mockReturnValue(false)
})

describe('backend selection', () => {
  it('uses the Upstash backend when REDIS_URL is unset', async () => {
    upstash.check.mockResolvedValue({ success: true, remaining: 4, retryAfter: 0 })
    await rateLimitAction('login', 'u1')
    expect(upstash.check).toHaveBeenCalledWith('login', 'u1', expect.objectContaining({ attempts: 5, window: '15 m' }))
    expect(tcp.check).not.toHaveBeenCalled()
  })

  it('uses the TCP backend when REDIS_URL is set', async () => {
    mockIsTcp.mockReturnValue(true)
    tcp.check.mockResolvedValue({ success: true, remaining: 1, retryAfter: 0 })
    await rateLimitAction('login', 'u1')
    expect(tcp.check).toHaveBeenCalledWith('login', 'u1', expect.objectContaining({ attempts: 5 }))
    expect(upstash.check).not.toHaveBeenCalled()
  })
})

describe('rateLimitAction', () => {
  it('returns null when allowed', async () => {
    upstash.check.mockResolvedValue({ success: true, remaining: 4, retryAfter: 0 })
    expect(await rateLimitAction('login', 'u1')).toBeNull()
  })

  it('returns a denied ActionState when over the limit', async () => {
    upstash.check.mockResolvedValue({ success: false, remaining: 0, retryAfter: 120 })
    const result = await rateLimitAction('login', 'u1')
    expect(result?.success).toBe(false)
    expect(result?.message).toMatch(/Too many attempts/)
  })

  it('fails open in development when the backend throws', async () => {
    vi.stubEnv('NODE_ENV', 'development')
    upstash.check.mockRejectedValue(new Error('redis down'))
    expect(await rateLimitAction('login', 'u1')).toBeNull()
  })

  it('fails closed in production when the backend throws', async () => {
    vi.stubEnv('NODE_ENV', 'production')
    upstash.check.mockRejectedValue(new Error('redis down'))
    const result = await rateLimitAction('stripeSync', 'u1')
    expect(result?.success).toBe(false)
  })
})

describe('checkRateLimit', () => {
  it('returns the envelope-free result', async () => {
    upstash.check.mockResolvedValue({ success: false, remaining: 0, retryAfter: 30 })
    expect(await checkRateLimit('itemMutation', 'u1')).toEqual({ success: false, retryAfter: 30 })
  })
})

describe('withRateLimit', () => {
  it('calls fn and returns its result when allowed', async () => {
    upstash.check.mockResolvedValue({ success: true, remaining: 9, retryAfter: 0 })
    const fn = vi.fn().mockResolvedValue({ success: true })
    const result = await withRateLimit('login', fn)
    expect(fn).toHaveBeenCalledOnce()
    expect(result).toEqual({ success: true })
  })

  it('returns the denied state without calling fn when rate limited', async () => {
    upstash.check.mockResolvedValue({ success: false, remaining: 0, retryAfter: 60 })
    const fn = vi.fn()
    const result = await withRateLimit('login', fn)
    expect(fn).not.toHaveBeenCalled()
    expect(result.success).toBe(false)
  })
})

describe('resetRateLimit', () => {
  it('delegates to the backend reset', async () => {
    upstash.reset.mockResolvedValue(undefined)
    await resetRateLimit('aiBrainDump', 'u1')
    expect(upstash.reset).toHaveBeenCalledWith('aiBrainDump', 'u1', expect.objectContaining({ attempts: 1 }))
  })

  it('swallows backend errors (never throws)', async () => {
    upstash.reset.mockRejectedValue(new Error('redis down'))
    await expect(resetRateLimit('login', 'u1')).resolves.toBeUndefined()
  })
})

describe('getAiUsage', () => {
  it('maps getRemainingMany results to one entry per AI key', async () => {
    const resetAt = Date.now() + 30 * 60_000
    upstash.getRemainingMany.mockResolvedValue(AI_RATE_LIMIT_KEYS.map(() => ({ remaining: 7, resetAt })))

    const usage = await getAiUsage('u1')

    expect(usage.map((u) => u.key)).toEqual([...AI_RATE_LIMIT_KEYS])
    for (const entry of usage) {
      expect(entry.limit).toBe(AI_FEATURE_HOURLY_LIMIT)
      expect(entry.remaining).toBe(7)
      expect(entry.resetAt).toBe(resetAt)
    }
    // Requests are built per key with the identifier + that key's config.
    const requests = upstash.getRemainingMany.mock.calls[0][0]
    expect(requests.map((r: { key: string }) => r.key)).toEqual([...AI_RATE_LIMIT_KEYS])
    expect(requests[0].identifier).toBe('u1')
  })

  it('routes through the TCP backend when REDIS_URL is set', async () => {
    mockIsTcp.mockReturnValue(true)
    tcp.getRemainingMany.mockResolvedValue(AI_RATE_LIMIT_KEYS.map(() => ({ remaining: 2, resetAt: 0 })))
    const usage = await getAiUsage('u1')
    expect(tcp.getRemainingMany).toHaveBeenCalledOnce()
    expect(usage.every((u) => u.remaining === 2)).toBe(true)
  })

  it('fails open with full budget when the read throws', async () => {
    upstash.getRemainingMany.mockRejectedValue(new Error('redis down'))
    const usage = await getAiUsage('u1')
    expect(usage.every((u) => u.remaining === AI_FEATURE_HOURLY_LIMIT && u.resetAt === 0)).toBe(true)
  })
})

describe('getBrainDumpUsage', () => {
  it('reads the aiBrainDump budget non-consumingly (one-element batch)', async () => {
    const resetAt = Date.now() + 3_600_000
    upstash.getRemainingMany.mockResolvedValue([{ remaining: 0, resetAt }])
    const usage = await getBrainDumpUsage('u1')
    expect(usage).toEqual({ key: 'aiBrainDump', limit: 1, remaining: 0, resetAt })
    expect(upstash.getRemainingMany).toHaveBeenCalledWith([
      { key: 'aiBrainDump', identifier: 'u1', config: expect.objectContaining({ attempts: 1 }) },
    ])
  })

  it('fails open with full budget when the read throws', async () => {
    upstash.getRemainingMany.mockRejectedValue(new Error('redis down'))
    expect(await getBrainDumpUsage('u1')).toEqual({ key: 'aiBrainDump', limit: 1, remaining: 1, resetAt: 0 })
  })
})

describe('deniedMessage', () => {
  it('pluralizes minutes above one', () => {
    expect(deniedMessage(120)).toMatch(/2 minutes/)
    expect(deniedMessage(30)).toMatch(/in a moment/)
  })
})
