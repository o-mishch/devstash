import 'server-only'

import { cache } from 'react'
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
import { resolveProAccessForBillingContext } from '@/lib/billing/access/pro-access-resolution'
import { createLogger } from '@/lib/infra/logger'

const log = createLogger('billing-state')

export interface FreshBillingContextOptions {
  /** Bypass request-scoped caches for the DB Stripe row (and Pro access when combined with bypass). */
  freshBillingContext?: boolean
}

/** Request-scoped user Stripe row — deduplicates DB reads within a single server render. */
export const getCachedUserStripeInfo = cache(getUserStripeInfo)

/** Uncached read — use after billing writes in the same request. */
export const getFreshUserStripeInfo = getUserStripeInfo

/** Request-scoped Stripe subscription fetch — shared by sync, Pro checks, and billing display. */
export const getCachedLiveSubscriptionState = cache((subscriptionId: string) =>
  fetchLiveSubscriptionState(subscriptionId),
)

export interface CheckoutUiStateInput {
  needsBillingRecovery: boolean
  billingUnavailable: boolean
  /** Live Stripe fetch failed for a linked subscription — block checkout without recovery copy. */
  liveStripeUnavailable?: boolean
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
  if (input.liveStripeUnavailable && input.hasLinkedSubscription) {
    return { checkoutDisabled: true, checkoutDisabledMessage: BILLING_UNAVAILABLE_MESSAGE }
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
 * DB fields come from passive sync and throttled orphan reconcile in the app layout;
 * Pro access and Stripe status share the request-scoped live check in pro-access-resolution.
 */

export interface UserBillingState {
  email: string | null
  /** From the local database — updated by webhooks and passive sync. */
  stripeCustomerId: string | null
  /** From the local database — updated by webhooks and passive sync. */
  stripeSubscriptionId: string | null
  /** Live Stripe check — may differ briefly from the database `isPro` flag. */
  isPro: boolean
  /** From the local database — updated by webhooks and passive sync. */
  subscriptionStart: Date | null
  /** From the local database — updated by webhooks and passive sync. */
  currentPeriodEnd: Date | null
  /** From the local database — updated by webhooks and passive sync. */
  subscriptionInterval: SubscriptionInterval | null
  /** From the local database — updated by webhooks and passive sync. */
  cancelAtPeriodEnd: boolean
  /** Live Stripe check — shares the request-scoped fetch with Pro enforcement. */
  stripeStatus: LiveSubscriptionState['status']
  /** True when live Stripe status could not be fetched for a linked subscription. */
  liveStripeUnavailable: boolean
}

export async function getUserBillingState(
  userId: string,
  options?: FreshBillingContextOptions,
): Promise<UserBillingState | null> {
  const stripeInfo = options?.freshBillingContext
    ? await getFreshUserStripeInfo(userId)
    : await getCachedUserStripeInfo(userId)
  if (!stripeInfo) return null

  const [isPro, stripeStatusResult] = await Promise.all([
    resolveProAccessForBillingContext(userId, options),
    stripeInfo.stripeSubscriptionId
      ? getCachedLiveSubscriptionState(stripeInfo.stripeSubscriptionId).then((live) => ({
          status: live?.status ?? null,
          unavailable: live === null,
        }))
      : Promise.resolve({ status: null, unavailable: false }),
  ])

  return {
    email: stripeInfo.email,
    stripeCustomerId: stripeInfo.stripeCustomerId,
    stripeSubscriptionId: stripeInfo.stripeSubscriptionId,
    isPro,
    subscriptionStart: stripeInfo.subscriptionStart,
    currentPeriodEnd: stripeInfo.currentPeriodEnd,
    subscriptionInterval: stripeInfo.subscriptionInterval,
    cancelAtPeriodEnd: stripeInfo.cancelAtPeriodEnd,
    stripeStatus: stripeStatusResult.status,
    liveStripeUnavailable: stripeStatusResult.unavailable,
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
  return subscriptionNeedsBillingPortalRecovery(billing.stripeStatus)
}

/** Shared billing display state for settings and upgrade pages. */
export async function loadBillingDisplayContext(
  userId: string,
  sessionFallbackIsPro: boolean,
  options?: FreshBillingContextOptions,
): Promise<BillingDisplayContext> {
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
    log.warn('Failed to load billing state for display', { userId, error })
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
  const displayContext = await loadBillingDisplayContext(userId, sessionFallbackIsPro, options)
  const { configured: checkoutConfigured, monthly: priceIdMonthly, yearly: priceIdYearly } = getCheckoutConfig()
  const { checkoutDisabled, checkoutDisabledMessage } = resolveCheckoutUiState({
    needsBillingRecovery: displayContext.needsBillingRecovery,
    billingUnavailable: displayContext.unavailable,
    liveStripeUnavailable: displayContext.billing?.liveStripeUnavailable ?? false,
    hasLinkedSubscription: Boolean(displayContext.billing?.stripeSubscriptionId),
    checkoutConfigured,
    subscriptionStatus: displayContext.billing?.stripeStatus ?? undefined,
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
