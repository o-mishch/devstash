import 'server-only'

import { cache } from 'react'
import type { LiveSubscriptionState } from '@/lib/billing/stripe-api'
import { shouldTrustCachedProAccess } from '@/lib/billing/config/billing-config'
import { subscriptionHasProAccess } from '@/lib/billing/subscription/subscription-access'
import { readProAccessCache, writeProAccessCache, PRO_ACCESS_OUTAGE_DENY_TTL_SECONDS } from '@/lib/billing/access/pro-access-cache'
import {
  type FreshBillingContextOptions,
  getCachedLiveSubscriptionState,
  getCachedUserStripeInfo,
  getFreshUserStripeInfo,
} from '@/lib/billing/sync/user-billing-state'
import { createLogger } from '@/lib/infra/logger'

const log = createLogger('pro-access')

/** Per-request fresh Pro results keyed by user — avoids duplicate live checks after layout refresh. */
const getBillingRequestScope = cache(() => ({
  freshProAccessByUserId: new Map<string, boolean>(),
}))

/** Resets request-scoped fresh Pro state — for unit tests only. */
export function clearBillingRequestScopeForTests(): void {
  getBillingRequestScope().freshProAccessByUserId.clear()
}

export function getStoredFreshProAccess(userId: string): boolean | null {
  const value = getBillingRequestScope().freshProAccessByUserId.get(userId)
  return value ?? null
}

export function markFreshProAccessResolved(userId: string, isPro: boolean): void {
  getBillingRequestScope().freshProAccessByUserId.set(userId, isPro)
}

/**
 * Pro access enforcement — use `getCachedVerifiedProAccess` everywhere except post-write
 * billing reads (`getFreshVerifiedProAccess`) and pre-mutation guards (`resolveProAccessBypassingCache`).
 * Billing display lives in `user-billing-state.ts`.
 */

function proAccessFromLiveState(live: LiveSubscriptionState | null): boolean | null {
  if (!live) return null
  if (!live.exists) return false
  return subscriptionHasProAccess(live.status)
}

type UserStripeRow = NonNullable<Awaited<ReturnType<typeof getCachedUserStripeInfo>>>

export interface ResolveProAccessOptions extends FreshBillingContextOptions {
  /** Skip the Redis Pro cache (pre-mutation guards). */
  bypassCache?: boolean
}

async function resolveProAccessReadOnly(userId: string, user: UserStripeRow): Promise<boolean | null> {
  const subscriptionId = user.stripeSubscriptionId

  if (!subscriptionId) {
    if (user.isPro) {
      log.warn('User has isPro without a linked Stripe subscription — denying Pro access', { userId })
    }
    return false
  }

  const live = await getCachedLiveSubscriptionState(subscriptionId)
  const liveAccess = proAccessFromLiveState(live)
  if (liveAccess !== null) return liveAccess

  if (shouldTrustCachedProAccess(user.isPro, user.lastStripeSyncAt, Date.now(), {
    currentPeriodEnd: user.currentPeriodEnd,
    proExpiredAt: user.proExpiredAt,
  })) {
    log.warn('Stripe API unavailable — using cached Pro access from recent sync', {
      userId,
      subscriptionId,
      lastStripeSyncAt: user.lastStripeSyncAt?.toISOString(),
    })
    return true
  }

  if (live === null) {
    if (user.isPro && subscriptionId && !user.proExpiredAt) {
      const periodValid = !user.currentPeriodEnd || user.currentPeriodEnd.getTime() > Date.now()
      if (periodValid) {
        log.warn('Stripe API unavailable — granting Pro from DB entitlement during outage', {
          userId,
          subscriptionId,
          currentPeriodEnd: user.currentPeriodEnd?.toISOString() ?? null,
        })
        return true
      }
    }
    return null
  }

  return false
}

async function resolveProAccessWithUser(
  userId: string,
  options?: ResolveProAccessOptions,
): Promise<boolean> {
  if (!options?.bypassCache) {
    const cached = await readProAccessCache(userId)
    if (cached !== null) return cached
  }

  const row = options?.freshBillingContext
    ? await getFreshUserStripeInfo(userId)
    : await getCachedUserStripeInfo(userId)
  if (!row) {
    await writeProAccessCache(userId, false)
    return false
  }

  const isPro = await resolveProAccessReadOnly(userId, row)
  if (isPro === null) {
    await writeProAccessCache(userId, false, PRO_ACCESS_OUTAGE_DENY_TTL_SECONDS)
    return false
  }
  await writeProAccessCache(userId, isPro)
  return isPro
}

async function getCachedVerifiedProAccessImpl(userId: string): Promise<boolean> {
  const stored = getStoredFreshProAccess(userId)
  if (stored !== null) return stored
  return resolveProAccessWithUser(userId)
}

/** Request-scoped cache — live Stripe check for JWT, actions, API routes, and sidebar. */
export const getCachedVerifiedProAccess = cache(getCachedVerifiedProAccessImpl)

/** Uncached Pro check with a fresh DB row — use after billing writes in the same request. */
export function getFreshVerifiedProAccess(userId: string): Promise<boolean> {
  return resolveProAccessWithUser(userId, { bypassCache: true, freshBillingContext: true })
}

/** Session display fallback — fail closed when Pro resolution errors. */
export async function resolveSessionUserIsPro(userId: string): Promise<boolean> {
  try {
    return await getCachedVerifiedProAccess(userId)
  } catch (error) {
    log.error('Failed to resolve Pro access for session', { userId, error })
    return false
  }
}

/** Pre-mutation guard — skips Redis read, resolves from DB + live Stripe, then refreshes cache. */
export async function resolveProAccessBypassingCache(userId: string): Promise<boolean> {
  return resolveProAccessWithUser(userId, { bypassCache: true })
}

/** Shared fresh/cached Pro branch for sidebar and billing display — dedupes layout refreshes. */
export async function resolveProAccessForBillingContext(
  userId: string,
  options?: FreshBillingContextOptions,
): Promise<boolean> {
  if (!options?.freshBillingContext) {
    return getCachedVerifiedProAccess(userId)
  }
  const stored = getStoredFreshProAccess(userId)
  if (stored !== null) {
    return stored
  }
  const isPro = await getFreshVerifiedProAccess(userId)
  markFreshProAccessResolved(userId, isPro)
  return isPro
}
