import 'server-only'

import { makeRedisCache } from '@/lib/infra/redis-cache'

/** 5 min TTL to cut Stripe API load while keeping entitlement checks reasonably fresh. */
export const PRO_ACCESS_CACHE_TTL_SECONDS = 300

/** Shorter TTL when Stripe is unreachable — avoids hammering the API during outages. */
export const PRO_ACCESS_OUTAGE_DENY_TTL_SECONDS = 30

const cache = makeRedisCache<boolean>({
  namespace: 'stripe:pro-access',
  defaultTtlSeconds: PRO_ACCESS_CACHE_TTL_SECONDS,
  logTag: 'pro-access-cache',
  warnMissingRedisInProduction: true,
})

export async function readProAccessCache(userId: string): Promise<boolean | null> {
  return cache.read(userId)
}

export async function writeProAccessCache(
  userId: string,
  isPro: boolean,
  ttlSeconds = PRO_ACCESS_CACHE_TTL_SECONDS,
): Promise<void> {
  return cache.write(userId, isPro, ttlSeconds)
}

export async function invalidateProAccessCache(userId: string): Promise<void> {
  return cache.invalidate(userId)
}

export async function invalidateProAccessForUserIds(userIds: Iterable<string>): Promise<void> {
  return cache.invalidateMany(userIds)
}
