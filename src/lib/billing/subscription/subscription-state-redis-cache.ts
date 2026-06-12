import 'server-only'

import type { LiveSubscriptionState } from '@/lib/billing/stripe-api'
import { makeRedisCache } from '@/lib/infra/redis-cache'

/** 5 min TTL for subscription state cache — reduces Stripe API calls on cache hit. */
export const SUBSCRIPTION_STATE_CACHE_TTL_SECONDS = 300

const cache = makeRedisCache<LiveSubscriptionState>({
  namespace: 'stripe:subscription-state',
  defaultTtlSeconds: SUBSCRIPTION_STATE_CACHE_TTL_SECONDS,
  logTag: 'subscription-cache',
  warnMissingRedisInProduction: true,
})

export async function readSubscriptionStateCache(
  subscriptionId: string,
): Promise<LiveSubscriptionState | null> {
  return cache.read(subscriptionId)
}

export async function writeSubscriptionStateCache(
  subscriptionId: string,
  state: LiveSubscriptionState,
  ttlSeconds = SUBSCRIPTION_STATE_CACHE_TTL_SECONDS,
): Promise<void> {
  return cache.write(subscriptionId, state, ttlSeconds)
}

export async function invalidateSubscriptionStateCache(subscriptionId: string): Promise<void> {
  return cache.invalidate(subscriptionId)
}

export async function invalidateSubscriptionStateForIds(
  subscriptionIds: Iterable<string>,
): Promise<void> {
  return cache.invalidateMany(subscriptionIds)
}
