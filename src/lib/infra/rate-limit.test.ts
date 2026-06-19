import { beforeEach, describe, expect, it, vi } from 'vitest'

const mockLimit = vi.fn()

vi.mock('@upstash/ratelimit', () => ({
  Ratelimit: vi.fn().mockImplementation(() => ({
    limit: mockLimit,
  })),
}))

vi.mock('@/lib/infra/redis', () => ({
  RATE_LIMIT_NS: 'devstash:test',
  getRedis: vi.fn(),
}))

import { getRedis } from '@/lib/infra/redis'
import { rateLimitAction, withRateLimit, resetRateLimitersForTests } from '@/lib/infra/rate-limit'

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
