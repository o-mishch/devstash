import 'server-only'

import type { Ratelimit } from '@upstash/ratelimit'
import { getRedis } from '@/lib/infra/redis'
import {
  RATE_LIMIT_NS,
  type RateLimitBackend,
  type RateLimitCheckResult,
  type RateLimitConfig,
  type RateLimitReadRequest,
  type RateLimitRemaining,
} from '@/lib/infra/rate-limit-types'

// Vercel/serverless rate-limit backend: the connectionless @upstash/redis REST client + the
// @upstash/ratelimit weighted sliding-window limiter. @upstash/ratelimit is dynamically imported
// so it never loads on the self-hosted path (next.config trace-excludes it from that image). One
// Ratelimit per action (keyed by its prefix), cached across calls.

const limiters = new Map<string, Ratelimit>()

async function getLimiter(key: string, { attempts, window }: RateLimitConfig): Promise<Ratelimit> {
  const cached = limiters.get(key)
  if (cached) return cached
  const redis = getRedis()
  if (!redis) throw new Error('rate-limit: Upstash Redis unavailable')
  const { Ratelimit } = await import('@upstash/ratelimit')
  const limiter = new Ratelimit({
    redis,
    limiter: Ratelimit.slidingWindow(attempts, window),
    prefix: `${RATE_LIMIT_NS}:${key}`,
  })
  limiters.set(key, limiter)
  return limiter
}

async function check(key: string, identifier: string, config: RateLimitConfig): Promise<RateLimitCheckResult> {
  const limiter = await getLimiter(key, config)
  const { success, remaining, reset } = await limiter.limit(identifier)
  return { success, remaining, retryAfter: Math.max(0, Math.ceil((reset - Date.now()) / 1000)) }
}

async function getRemainingMany(requests: RateLimitReadRequest[]): Promise<RateLimitRemaining[]> {
  // Resolve every limiter first, THEN issue all getRemaining reads in the same tick so
  // @upstash/redis auto-pipelining collapses them into a single /pipeline round-trip. Limiters are
  // just cached objects (built once), so resolving them one-by-one costs nothing; the READS below
  // are the round-trips, and they stay parallel/same-tick — that is what actually pipelines.
  const built: Ratelimit[] = []
  for (const r of requests) built.push(await getLimiter(r.key, r.config))
  const results = await Promise.all(built.map((limiter, i) => limiter.getRemaining(requests[i].identifier)))
  return results.map(({ remaining, reset }) => ({ remaining, resetAt: reset }))
}

async function reset(key: string, identifier: string, config: RateLimitConfig): Promise<void> {
  const limiter = await getLimiter(key, config)
  // NOTE: Upstash resetUsedTokens zeroes the whole window (all consumed tokens), not one decrement.
  await limiter.resetUsedTokens(identifier)
}

export const upstashRateLimit: RateLimitBackend = { check, getRemainingMany, reset }

/** Clears cached limiters — tests only. */
export function resetUpstashLimitersForTests(): void {
  limiters.clear()
}
