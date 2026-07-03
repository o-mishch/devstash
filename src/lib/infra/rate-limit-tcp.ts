import 'server-only'

import type { RateLimiterRedis, RateLimiterRes } from 'rate-limiter-flexible'
import {
  RATE_LIMIT_NS,
  type Duration,
  type RateLimitBackend,
  type RateLimitCheckResult,
  type RateLimitConfig,
  type RateLimitReadRequest,
  type RateLimitRemaining,
} from '@/lib/infra/rate-limit-types'

// Self-hosted rate-limit backend (node-redis → Memorystore for Valkey / local Redis). Over a
// persistent connection the connectionless @upstash/ratelimit REST limiter can't be used, so this
// path runs the standard `rate-limiter-flexible` library (RateLimiterRedis): atomic (Lua/EVAL
// under the hood), fixed-window per key, keyed identically to the Upstash path (`rl:<action>:<id>`).
//
// node-redis and rate-limiter-flexible are both pulled in via dynamic import so they stay off the
// Vercel bundle (next.config trace-excludes them there). One RateLimiterRedis per action, cached.

const WINDOW_UNIT_SECONDS: Record<string, number> = { ms: 0.001, s: 1, m: 60, h: 3_600, d: 86_400 }

function parseWindowSeconds(window: Duration): number {
  const [amount, unit] = window.split(' ')
  // rate-limiter-flexible's `duration` is integer seconds, and `duration: 0` means "no expiry"
  // (a permanent counter). Clamp to ≥1s so a sub-second window (e.g. '200 ms') never silently
  // becomes permanent on this backend while the Upstash backend still honors it.
  return Math.max(1, Math.round(Number(amount) * (WINDOW_UNIT_SECONDS[unit] ?? 1)))
}

const limiters = new Map<string, RateLimiterRedis>()

async function getLimiter(key: string, { attempts, window }: RateLimitConfig): Promise<RateLimiterRedis> {
  const cached = limiters.get(key)
  if (cached) return cached
  // Dynamic imports so node-redis + rate-limiter-flexible never enter the Vercel bundle: this
  // module is statically imported by rate-limit.ts (loaded everywhere), but these deps load only
  // on the self-hosted path. The underlying node-redis client is a stable singleton (survives
  // reconnects), so caching the limiter that holds it is safe.
  const [{ getTcpRedisClient }, { RateLimiterRedis }] = await Promise.all([
    import('@/lib/infra/redis-tcp'),
    import('rate-limiter-flexible'),
  ])
  const storeClient = await getTcpRedisClient()
  const limiter = new RateLimiterRedis({
    storeClient,
    useRedisPackage: true,
    points: attempts,
    duration: parseWindowSeconds(window),
    keyPrefix: `${RATE_LIMIT_NS}:${key}`,
  })
  limiters.set(key, limiter)
  return limiter
}

// rate-limiter-flexible rejects consume() with a RateLimiterRes when the limit is hit, but with a
// real Error when the store itself fails. This is the library's documented contract (an allowed
// `instanceof` boundary, like ZodError) — a store failure must propagate so the caller can apply
// its fail-open/closed policy, not be mistaken for "rate limited".
function isRateLimiterRes(rejected: unknown): rejected is RateLimiterRes {
  return !(rejected instanceof Error)
}

async function check(key: string, identifier: string, config: RateLimitConfig): Promise<RateLimitCheckResult> {
  const limiter = await getLimiter(key, config)
  try {
    const res = await limiter.consume(identifier)
    return { success: true, remaining: res.remainingPoints, retryAfter: 0 }
  } catch (rejected) {
    if (!isRateLimiterRes(rejected)) throw rejected
    return { success: false, remaining: 0, retryAfter: Math.max(0, Math.ceil(rejected.msBeforeNext / 1000)) }
  }
}

async function readOne({ key, identifier, config }: RateLimitReadRequest): Promise<RateLimitRemaining> {
  const limiter = await getLimiter(key, config)
  // get() returns null when no window exists yet → full budget.
  const res = await limiter.get(identifier)
  if (!res) return { remaining: config.attempts, resetAt: 0 }
  return { remaining: Math.max(0, res.remainingPoints), resetAt: Date.now() + res.msBeforeNext }
}

async function getRemainingMany(requests: RateLimitReadRequest[]): Promise<RateLimitRemaining[]> {
  return Promise.all(requests.map(readOne))
}

async function reset(key: string, identifier: string, config: RateLimitConfig): Promise<void> {
  // Config passed so this resolves the SAME cached limiter check() uses (never a dummy).
  const limiter = await getLimiter(key, config)
  await limiter.delete(identifier)
}

export const tcpRateLimit: RateLimitBackend = { check, getRemainingMany, reset }

/** Clears cached limiters — tests only. */
export function resetTcpLimitersForTests(): void {
  limiters.clear()
}
