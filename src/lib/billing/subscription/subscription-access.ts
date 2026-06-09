import 'server-only'

import type Stripe from 'stripe'

/**
 * Pro entitlement rules (live Stripe status is authoritative; see pro-access-resolution.ts).
 *
 * | Status              | Pro access | Local sub link     | New checkout      |
 * |---------------------|------------|--------------------|-------------------|
 * | active, trialing    | Yes        | Kept               | Blocked           |
 * | past_due            | Yes (grace)| Kept               | Blocked → portal  |
 * | unpaid, paused      | No         | Kept → portal only | Blocked → portal  |
 * | canceled, inc_exp   | No         | Cleared            | Allowed           |
 * | incomplete          | No         | Kept until abandon | Blocked           |
 */

export function subscriptionHasProAccess(status: Stripe.Subscription.Status | null | undefined): boolean {
  return status === 'active' || status === 'trialing' || status === 'past_due'
}

/**
 * Whether checkout fulfillment should grant Pro access.
 * Stripe: provision when payment_status is not `unpaid` (includes `no_payment_required`).
 * @see https://docs.stripe.com/checkout/fulfillment
 */
export function shouldGrantCheckoutProAccess(
  paymentStatus: Stripe.Checkout.Session['payment_status'] | null,
  subscriptionStatus: Stripe.Subscription.Status,
  forceActivate = false,
): boolean {
  if (forceActivate) return true
  if (subscriptionStatus === 'trialing') return true
  if (paymentStatus === 'unpaid') return false
  return subscriptionHasProAccess(subscriptionStatus)
}

/** Terminal or abandoned Stripe statuses that should not block a new Checkout session. */
export function checkoutSubscriptionBlocksNewCheckout(status: Stripe.Subscription.Status): boolean {
  return (
    status !== 'canceled'
    && status !== 'incomplete'
    && status !== 'incomplete_expired'
  )
}

/**
 * Stripe statuses where the local subscription link should be cleared (customer ID is kept for portal).
 * `incomplete` is excluded — checkout awaiting async payment keeps the link until
 * checkout.session.expired or checkout.session.async_payment_failed fires.
 */
export function subscriptionShouldClearLocalLink(status: Stripe.Subscription.Status | null | undefined): boolean {
  return status === 'incomplete_expired' || status === 'canceled'
}

/** True when access is scheduled to end — not when cancellation already completed. */
export function isSubscriptionCanceling(
  sub: Pick<Stripe.Subscription, 'cancel_at_period_end' | 'cancel_at'>,
): boolean {
  return sub.cancel_at_period_end || sub.cancel_at !== null
}

/**
 * Routine renewals update period end on `invoice.paid`.
 * Skip redundant period writes on `customer.subscription.updated` for entitled subs.
 */
export function shouldDeferPeriodEndToInvoicePaid(
  status: Stripe.Subscription.Status,
  isCanceling: boolean,
): boolean {
  return subscriptionHasProAccess(status) && !isCanceling
}
