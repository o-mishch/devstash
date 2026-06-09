import 'server-only'

import type Stripe from 'stripe'
import { listStripeWebhookEndpoints } from '@/lib/billing/stripe-api'
import { validateStripeWebhookEndpoints } from './stripe-webhook-config'
import type { StripeWebhookValidationResult } from './stripe-webhook-config'
export {
  getStripeEventDescription,
  REQUIRED_STRIPE_WEBHOOK_EVENTS,
} from './stripe-webhook-config'
export type {
  RequiredStripeWebhookEvent,
  StripeWebhookEndpointValidation,
  StripeWebhookValidationResult,
} from './stripe-webhook-config'

/** Max age of `lastStripeSyncAt` during which DB `isPro` is trusted when live Stripe is unavailable. */
export const STRIPE_OUTAGE_FALLBACK_MS = 6 * 60 * 60 * 1000

/** How long display views can trust DB subscription fields before passive sync runs. */
export const SUBSCRIPTION_DISPLAY_LIVE_CHECK_MS = 15 * 60 * 1000

/** Minimum interval between Stripe orphan-subscription lookups for users without a local sub ID. */
export const ORPHAN_RECONCILE_INTERVAL_MS = 60 * 60 * 1000

/** Statuses that block new checkout and should route customers to Billing Portal for recovery. */
export const BILLING_PORTAL_RECOVERY_STATUSES = ['past_due', 'unpaid', 'paused'] as const

export type BillingPortalRecoveryStatus = (typeof BILLING_PORTAL_RECOVERY_STATUSES)[number]

const BILLING_RECOVERY_STATUS_SET = new Set<string>(BILLING_PORTAL_RECOVERY_STATUSES)

/** Stripe statuses where checkout is blocked and the customer should use Billing Portal. */
export function subscriptionNeedsBillingPortalRecovery(
  status: Stripe.Subscription.Status | null | undefined,
): boolean {
  return status != null && BILLING_RECOVERY_STATUS_SET.has(status)
}

export interface ProAccessTrustContext {
  currentPeriodEnd?: Date | null
  proExpiredAt?: Date | null
}

/**
 * Fail-open Pro access when Stripe is unreachable but DB was recently synced.
 * Denies when period or `proExpiredAt` has passed. Webhooks and passive sync heal state after recovery.
 */
export function shouldTrustCachedProAccess(
  isPro: boolean,
  lastStripeSyncAt: Date | null | undefined,
  now = Date.now(),
  context?: ProAccessTrustContext,
): boolean {
  if (!isPro || !lastStripeSyncAt) return false
  if (context?.proExpiredAt && context.proExpiredAt.getTime() <= now) return false
  if (context?.currentPeriodEnd && context.currentPeriodEnd.getTime() <= now) return false
  return now - lastStripeSyncAt.getTime() < STRIPE_OUTAGE_FALLBACK_MS
}

export interface PassiveBillingSyncInput {
  email: string | null
  stripeCustomerId: string | null
  stripeSubscriptionId: string | null
  isPro: boolean
  lastStripeSyncAt: Date | null
  currentPeriodEnd: Date | null
}

/** Whether a passive Stripe sync is worth running to heal missed webhooks or stale DB fields. */
export function shouldPassiveSyncBilling(user: PassiveBillingSyncInput, now = Date.now()): boolean {
  if (!user.stripeSubscriptionId) return false
  if (!user.lastStripeSyncAt) return true
  if (now - user.lastStripeSyncAt.getTime() >= SUBSCRIPTION_DISPLAY_LIVE_CHECK_MS) return true
  if (user.stripeCustomerId && !user.isPro) return true
  if (user.currentPeriodEnd && user.currentPeriodEnd.getTime() <= now) return true
  return false
}

/** Whether to look up a missed Stripe subscription on billing-sensitive pages. */
export function shouldRunOrphanReconcile(user: PassiveBillingSyncInput, now = Date.now()): boolean {
  if (!user.email || user.stripeSubscriptionId) return false
  if (!user.lastStripeSyncAt) return true
  return now - user.lastStripeSyncAt.getTime() >= ORPHAN_RECONCILE_INTERVAL_MS
}

/**
 * Compares Stripe Dashboard webhook subscriptions against REQUIRED_STRIPE_WEBHOOK_EVENTS.
 * Run via `npm run stripe:validate-webhooks` before go-live and after changing handlers.
 */
export async function validateStripeWebhookConfiguration(
  webhookPath = '/api/webhooks/stripe',
): Promise<StripeWebhookValidationResult> {
  const endpoints = await listStripeWebhookEndpoints()
  return validateStripeWebhookEndpoints(endpoints, webhookPath)
}
