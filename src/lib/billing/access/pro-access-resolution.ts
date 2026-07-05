import 'server-only'

import { cache } from 'react'
import {
  type FreshBillingContextOptions,
  getCachedUserStripeInfo,
  getFreshUserStripeInfo,
} from '@/lib/billing/sync/user-billing-state'
import { logger } from '@/lib/infra/pino'

const log = logger.child({ tag: 'pro-access' })

/** Per-request map — prevents duplicate fresh DB reads when getFreshVerifiedProAccess is called multiple times. */
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
 * billing reads (`getFreshVerifiedProAccess`) and billing display (`resolveProAccessForBillingContext`).
 * Trusts DB `isPro` which is kept current by Stripe webhooks — no live Stripe API call.
 */

interface ProAccessRow {
  isPro: boolean
  stripeSubscriptionId: string | null
}

/**
 * Pure Pro-access decision from an already-fetched user row (no DB call) — the shared rule behind
 * every resolver here, and stamped directly onto `token.isPro` by the auth `jwt` callback (which
 * fetches `isPro` + `stripeSubscriptionId` for session validation anyway). Pro requires a linked
 * Stripe subscription; DB `isPro` is trusted because Stripe webhooks keep it current.
 */
export function resolveProAccessFromRow(userId: string, user: ProAccessRow): boolean {
  if (!user.stripeSubscriptionId) {
    if (user.isPro) {
      log.warn({ userId }, 'User has isPro without a linked Stripe subscription — denying Pro access')
    }
    return false
  }
  return user.isPro
}

async function resolveProAccessWithUser(
  userId: string,
  options?: FreshBillingContextOptions,
): Promise<boolean> {
  const row = options?.freshBillingContext
    ? await getFreshUserStripeInfo(userId)
    : await getCachedUserStripeInfo(userId)
  if (!row) return false
  return resolveProAccessFromRow(userId, row)
}

async function getCachedVerifiedProAccessImpl(userId: string): Promise<boolean> {
  const stored = getStoredFreshProAccess(userId)
  if (stored !== null) return stored
  return resolveProAccessWithUser(userId)
}

/** Request-scoped cache — Pro check for JWT, actions, API routes, and sidebar. Reads DB only. */
export const getCachedVerifiedProAccess = cache(getCachedVerifiedProAccessImpl)

/** Uncached Pro check with a fresh DB row — use after billing writes in the same request. */
export function getFreshVerifiedProAccess(userId: string): Promise<boolean> {
  return resolveProAccessWithUser(userId, { freshBillingContext: true })
}

/** Session display fallback — fail closed when Pro resolution errors. */
export async function resolveSessionUserIsPro(userId: string): Promise<boolean> {
  try {
    return await getCachedVerifiedProAccess(userId)
  } catch (error) {
    log.error({ userId, err: error }, 'Failed to resolve Pro access for session')
    return false
  }
}

/** Pre-mutation guard — resolves from DB, bypasses request-scoped React cache. */
export async function resolveProAccessBypassingCache(userId: string): Promise<boolean> {
  return resolveProAccessWithUser(userId, { freshBillingContext: true })
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
