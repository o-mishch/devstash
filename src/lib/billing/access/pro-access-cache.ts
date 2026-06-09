import 'server-only'

import { getRedis } from '@/lib/infra/redis'
import { createLogger } from '@/lib/infra/logger'

const log = createLogger('pro-access-cache')

/** Short TTL to cut Stripe API load while keeping entitlement checks reasonably fresh. */
export const PRO_ACCESS_CACHE_TTL_SECONDS = 60

/** Shorter TTL when Stripe is unreachable — avoids hammering the API during outages. */
export const PRO_ACCESS_OUTAGE_DENY_TTL_SECONDS = 30

const PRO_ACCESS_CACHE_NS = 'stripe:pro-access'

// Process-local fallback for local dev only. In production, Upstash Redis
// (UPSTASH_REDIS_REST_URL + UPSTASH_REDIS_REST_TOKEN) is required — without it every
// Pro check hits the database and live Stripe, increasing latency and rate-limit risk.
const memoryCache = new Map<string, { isPro: boolean; expiresAt: number }>()

let loggedMissingRedisInProduction = false

function getProAccessCacheKey(userId: string): string {
  return `${PRO_ACCESS_CACHE_NS}:${userId}`
}

function shouldUseMemoryFallback(): boolean {
  return process.env.NODE_ENV !== 'production'
}

function warnMissingRedisInProductionOnce(): void {
  if (process.env.NODE_ENV !== 'production' || getRedis() || loggedMissingRedisInProduction) return
  loggedMissingRedisInProduction = true
  log.warn(
    'Upstash Redis is not configured in production — Pro access cache is disabled; every entitlement check will call Stripe',
    { envVars: ['UPSTASH_REDIS_REST_URL', 'UPSTASH_REDIS_REST_TOKEN'] },
  )
}

export async function readProAccessCache(userId: string): Promise<boolean | null> {
  const redis = getRedis()
  if (redis) {
    try {
      const cached = await redis.get<boolean>(getProAccessCacheKey(userId))
      if (typeof cached === 'boolean') return cached
    } catch (error) {
      log.warn('Pro access cache read failed', { userId, error })
    }
  } else {
    warnMissingRedisInProductionOnce()
  }

  if (!shouldUseMemoryFallback()) return null

  const entry = memoryCache.get(userId)
  if (!entry) return null
  if (Date.now() >= entry.expiresAt) {
    memoryCache.delete(userId)
    return null
  }
  return entry.isPro
}

export async function writeProAccessCache(
  userId: string,
  isPro: boolean,
  ttlSeconds = PRO_ACCESS_CACHE_TTL_SECONDS,
): Promise<void> {
  const redis = getRedis()
  if (redis) {
    try {
      await redis.set(getProAccessCacheKey(userId), isPro, { ex: ttlSeconds })
    } catch (error) {
      log.warn('Pro access cache write failed', { userId, error })
    }
  } else {
    warnMissingRedisInProductionOnce()
  }

  if (!shouldUseMemoryFallback()) return

  memoryCache.set(userId, {
    isPro,
    expiresAt: Date.now() + ttlSeconds * 1000,
  })
}

export async function invalidateProAccessCache(userId: string): Promise<void> {
  const redis = getRedis()
  if (redis) {
    try {
      await redis.del(getProAccessCacheKey(userId))
    } catch (error) {
      log.warn('Pro access cache invalidation failed', { userId, error })
    }
  }
  memoryCache.delete(userId)
}

export async function invalidateProAccessForUserIds(userIds: Iterable<string>): Promise<void> {
  await Promise.all([...userIds].map((userId) => invalidateProAccessCache(userId)))
}
