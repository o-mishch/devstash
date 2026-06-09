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

vi.mock('@/lib/api/api-response', () => ({
  ApiResponse: {
    TOO_MANY_REQUESTS: (message: string) => ({
      status: 'too_many_requests',
      data: null,
      message,
    }),
  },
}))

import { getRedis } from '@/lib/infra/redis'
import { rateLimitAction, resetRateLimitersForTests, withUserRateLimit } from '@/lib/infra/rate-limit'

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

    expect(result?.status).toBe('too_many_requests')
  })

  it('denies stripeSync when Redis is unavailable in production', async () => {
    vi.stubEnv('NODE_ENV', 'production')
    mockGetRedis.mockReturnValue(null)

    const result = await rateLimitAction('stripeSync', 'user-1')

    expect(result?.status).toBe('too_many_requests')
  })

  it('denies when limit is exceeded with Redis available', async () => {
    vi.stubEnv('NODE_ENV', 'production')
    mockLimit.mockResolvedValue({ success: false, remaining: 0, reset: Date.now() + 120_000 })

    const result = await rateLimitAction('login', 'user-1')

    expect(result?.status).toBe('too_many_requests')
    expect(result?.message).toMatch(/Too many attempts/)
  })

  it('withUserRateLimit returns the inner action result when not rate limited', async () => {
    vi.stubEnv('NODE_ENV', 'development')

    const result = await withUserRateLimit('updateSettings', 'user-42', async () => ({
      status: 'ok' as const,
      data: null,
      message: null,
    }))

    expect(result.status).toBe('ok')
  })
})
