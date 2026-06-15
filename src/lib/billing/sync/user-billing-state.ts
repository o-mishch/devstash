import 'server-only'

import { cache } from 'react'
import { cacheTag, cacheLife } from 'next/cache'
import type Stripe from 'stripe'
import type { SubscriptionInterval } from '@/generated/prisma'
import { getUserStripeInfo } from '@/lib/db/stripe'
import type { LiveSubscriptionState } from '@/lib/billing/stripe-api'
import { fetchLiveSubscriptionState } from '@/lib/billing/stripe-api'
import { getCheckoutConfig } from '@/lib/billing/config/billing-pricing'
import { subscriptionNeedsBillingPortalRecovery } from '@/lib/billing/config/billing-config'
import {
  BILLING_UNAVAILABLE_MESSAGE,
  getExistingSubscriptionMessage,
} from '@/lib/billing/messages/billing-messages'
import { CHECKOUT_NOT_CONFIGURED_MESSAGE } from '@/lib/billing/messages/billing-messages.client'
import { CacheTags } from '@/lib/infra/cache'
import { logger } from '@/lib/infra/pino'

const log = logger.child({ tag: 'billing-state' })

export interface FreshBillingContextOptions {
  /** Bypass request-scoped caches for the DB Stripe row. */
  freshBillingContext?: boolean
}

/** Request-scoped user Stripe row — deduplicates DB reads within a single server render. */
export const getCachedUserStripeInfo = cache(getUserStripeInfo)

/** Uncached read — use after billing writes in the same request. */
export const getFreshUserStripeInfo = getUserStripeInfo

async function fetchCachedLiveSubscriptionState(subscriptionId: string): Promise<LiveSubscriptionState | null> {
  'use cache'
  cacheTag(CacheTags.stripeSubscription(subscriptionId))
  // stale: 30s (serve stale while revalidating), revalidate: 120s, expire: 120s
  // Used by passive sync only — not on the primary Pro access check path.
  cacheLife({ stale: 30, revalidate: 120, expire: 120 })
  return fetchLiveSubscriptionState(subscriptionId)
}

/** Request-scoped Stripe subscription fetch — used by passive background sync. */
export const getCachedLiveSubscriptionState = cache(fetchCachedLiveSubscriptionState)

export interface CheckoutUiStateInput {
  needsBillingRecovery: boolean
  billingUnavailable: boolean
  hasLinkedSubscription?: boolean
  checkoutConfigured: boolean
  subscriptionStatus?: Stripe.Subscription.Status
}

export interface CheckoutUiState {
  checkoutDisabled: boolean
  checkoutDisabledMessage: string | null
}

/** Shared checkout eligibility for settings and upgrade UI — disable reason and inline copy. */
export function resolveCheckoutUiState(input: CheckoutUiStateInput): CheckoutUiState {
  if (input.billingUnavailable) {
    return { checkoutDisabled: true, checkoutDisabledMessage: BILLING_UNAVAILABLE_MESSAGE }
  }
  if (!input.checkoutConfigured) {
    return { checkoutDisabled: true, checkoutDisabledMessage: CHECKOUT_NOT_CONFIGURED_MESSAGE }
  }
  if (input.needsBillingRecovery) {
    return {
      checkoutDisabled: true,
      checkoutDisabledMessage: getExistingSubscriptionMessage(input.subscriptionStatus),
    }
  }
  return { checkoutDisabled: false, checkoutDisabledMessage: null }
}

/**
 * Billing display for settings and upgrade UI.
 * All fields read from local DB — kept current by Stripe webhooks.
 * No live Stripe API call on this path (Stripe's recommended pattern).
 */

export interface UserBillingState {
  email: string | null
  stripeCustomerId: string | null
  stripeSubscriptionId: string | null
  isPro: boolean
  /** Last known Stripe subscription status — stored by webhooks, used for billing display only. */
  stripeSubscriptionStatus: Stripe.Subscription.Status | null
  stripeSubscriptionStart: Date | null
  stripeCurrentPeriodEnd: Date | null
  stripeSubscriptionInterval: SubscriptionInterval | null
  stripeCancelAtPeriodEnd: boolean
}

export async function getUserBillingState(
  userId: string,
  options?: FreshBillingContextOptions,
): Promise<UserBillingState | null> {
  const stripeInfo = options?.freshBillingContext
    ? await getFreshUserStripeInfo(userId)
    : await getCachedUserStripeInfo(userId)
  if (!stripeInfo) return null

  return {
    email: stripeInfo.email,
    stripeCustomerId: stripeInfo.stripeCustomerId,
    stripeSubscriptionId: stripeInfo.stripeSubscriptionId,
    isPro: stripeInfo.isPro,
    stripeSubscriptionStatus: stripeInfo.stripeSubscriptionStatus as Stripe.Subscription.Status | null,
    stripeSubscriptionStart: stripeInfo.stripeSubscriptionStart,
    stripeCurrentPeriodEnd: stripeInfo.stripeCurrentPeriodEnd,
    stripeSubscriptionInterval: stripeInfo.stripeSubscriptionInterval,
    stripeCancelAtPeriodEnd: stripeInfo.stripeCancelAtPeriodEnd,
  }
}

const getCachedUserBillingState = cache((userId: string) => getUserBillingState(userId))

export interface BillingDisplayContext {
  billing: UserBillingState | null
  unavailable: boolean
  isPro: boolean
  needsBillingRecovery: boolean
}

export function resolveNeedsBillingRecovery(
  isPro: boolean,
  billing: UserBillingState | null,
): boolean {
  if (isPro || !billing?.stripeCustomerId) return false
  return subscriptionNeedsBillingPortalRecovery(billing.stripeSubscriptionStatus)
}

/** Shared billing display state for settings and upgrade pages. */
export async function loadBillingDisplayContext(
  userId: string,
  sessionFallbackIsPro: boolean,
  options?: FreshBillingContextOptions,
): Promise<BillingDisplayContext> {
  'use cache'
  cacheTag(CacheTags.billingDisplayContext(userId))
  cacheLife('max')
  try {
    const billing = options?.freshBillingContext
      ? await getUserBillingState(userId, { freshBillingContext: true })
      : await getCachedUserBillingState(userId)
    const isPro = billing?.isPro ?? sessionFallbackIsPro
    return {
      billing,
      unavailable: false,
      isPro,
      needsBillingRecovery: resolveNeedsBillingRecovery(isPro, billing),
    }
  } catch (error) {
    log.warn({ userId, err: error }, 'Failed to load billing state for display')
    return {
      billing: null,
      unavailable: true,
      isPro: sessionFallbackIsPro,
      needsBillingRecovery: false,
    }
  }
}

export interface BillingPageContext extends BillingDisplayContext {
  canManageBilling: boolean
  checkoutConfigured: boolean
  priceIdMonthly?: string
  priceIdYearly?: string
  checkoutDisabled: boolean
  checkoutDisabledMessage: string | null
}

/** Shared billing + checkout UI state for settings and upgrade pages. */
export async function loadBillingPageContext(
  userId: string,
  sessionFallbackIsPro: boolean,
  options?: FreshBillingContextOptions,
): Promise<BillingPageContext> {
  'use cache'
  cacheTag(CacheTags.billingPageContext(userId))
  cacheLife('max')
  const displayContext = await loadBillingDisplayContext(userId, sessionFallbackIsPro, options)
  const { configured: checkoutConfigured, monthly: priceIdMonthly, yearly: priceIdYearly } = getCheckoutConfig()
  const { checkoutDisabled, checkoutDisabledMessage } = resolveCheckoutUiState({
    needsBillingRecovery: displayContext.needsBillingRecovery,
    billingUnavailable: displayContext.unavailable,
    hasLinkedSubscription: Boolean(displayContext.billing?.stripeSubscriptionId),
    checkoutConfigured,
    subscriptionStatus: displayContext.billing?.stripeSubscriptionStatus as Stripe.Subscription.Status ?? undefined,
  })

  return {
    ...displayContext,
    canManageBilling: Boolean(displayContext.billing?.stripeCustomerId),
    checkoutConfigured,
    priceIdMonthly,
    priceIdYearly,
    checkoutDisabled,
    checkoutDisabledMessage,
  }
}
