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

/** Passive sync interval — 24h because webhooks keep the DB current. */
export const SUBSCRIPTION_DISPLAY_LIVE_CHECK_MS = 24 * 60 * 60 * 1000

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

export interface PassiveBillingSyncInput {
  email: string | null
  stripeCustomerId: string | null
  stripeSubscriptionId: string | null
  isPro: boolean
  stripeLastSyncAt: Date | null
  stripeCurrentPeriodEnd: Date | null
}

/** Whether a passive Stripe sync is worth running as a safety net for missed webhooks. */
export function shouldPassiveSyncBilling(user: PassiveBillingSyncInput, now = Date.now()): boolean {
  if (!user.stripeSubscriptionId) return false
  if (!user.stripeLastSyncAt) return true
  if (now - user.stripeLastSyncAt.getTime() >= SUBSCRIPTION_DISPLAY_LIVE_CHECK_MS) return true
  if (user.stripeCurrentPeriodEnd && user.stripeCurrentPeriodEnd.getTime() <= now) return true
  return false
}

/** Whether to look up a missed Stripe subscription on billing-sensitive pages. */
export function shouldRunOrphanReconcile(user: PassiveBillingSyncInput, now = Date.now()): boolean {
  if (!user.email || user.stripeSubscriptionId) return false
  if (!user.stripeLastSyncAt) return true
  return now - user.stripeLastSyncAt.getTime() >= ORPHAN_RECONCILE_INTERVAL_MS
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
