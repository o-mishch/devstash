import 'server-only'

import Stripe from 'stripe'
import { logger } from '@/lib/infra/pino'

/** Thin Stripe SDK adapter — checkout/portal/customer mutations live here.
 *  Domain billing logic and reads belong in `src/lib/billing/*`. */

const log = logger.child({ tag: 'stripe-sdk' })

let stripeClient: Stripe | undefined

function getStripeClient(): Stripe {
  if (!stripeClient) {
    const secretKey = process.env.STRIPE_SECRET_KEY
    if (!secretKey) {
      throw new Error('STRIPE_SECRET_KEY is missing. Please set it in your .env file.')
    }
    stripeClient = new Stripe(secretKey, {
      apiVersion: '2026-06-24.dahlia',
      appInfo: {
        name: 'DevStash Pro',
        version: '0.1.0',
      },
      typescript: true,
    })
  }
  return stripeClient
}

/** Lazy Stripe client — importing `@/lib/billing/stripe-utils` does not require STRIPE_SECRET_KEY. */
export const stripe: Stripe = new Proxy({} as Stripe, {
  get(_target, prop, receiver) {
    const client = getStripeClient()
    const value = Reflect.get(client, prop, receiver)
    return typeof value === 'function' ? value.bind(client) : value
  },
})

export function constructStripeWebhookEvent(
  body: string,
  signature: string,
  webhookSecret: string,
): Stripe.Event {
  return stripe.webhooks.constructEvent(body, signature, webhookSecret)
}

export interface CheckoutSessionParams {
  priceId: string
  userId: string
  userEmail?: string
  customerId?: string
  successUrl: string
  cancelUrl: string
}

// Outcome of reconciling a locally-stored Stripe customer id with Stripe:
//  - 'linked'  → the customer exists and is tagged with this user; safe to reuse.
//  - 'foreign' → the customer belongs to a DIFFERENT app user; must NOT be reused.
//  - 'deleted' → the customer was deleted in Stripe; the stored id is dead and must be dropped (the
//                caller falls back to `customer_email` so checkout recreates a fresh customer).
export type StripeCustomerLink = 'linked' | 'foreign' | 'deleted'

/** Tags a Stripe customer with the app user ID so email-based recovery prefers the right record. */
export async function ensureStripeCustomerUserId(customerId: string, userId: string): Promise<StripeCustomerLink> {
  const customer = await stripe.customers.retrieve(customerId)
  if ('deleted' in customer && customer.deleted) {
    log.warn({ customerId, userId }, 'Stored Stripe customer is deleted — treating link as stale')
    return 'deleted'
  }

  const existingUserId = typeof customer.metadata?.userId === 'string' ? customer.metadata.userId : null
  if (existingUserId === userId) return 'linked'
  if (existingUserId && existingUserId !== userId) {
    log.warn({
      customerId,
      requestedUserId: userId,
      existingUserId,
    }, 'Stripe customer already linked to another app user — refusing metadata update')
    return 'foreign'
  }

  await stripe.customers.update(customerId, {
    metadata: { ...customer.metadata, userId },
  })
  return 'linked'
}

/** Creates a Stripe Checkout session for a subscription. Throws on Stripe error. */
export async function createCheckoutSession(params: CheckoutSessionParams): Promise<Stripe.Checkout.Session> {
  return stripe.checkout.sessions.create({
    mode: 'subscription',
    line_items: [{ price: params.priceId, quantity: 1 }],
    success_url: `${params.successUrl}${params.successUrl.includes('?') ? '&' : '?'}session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: params.cancelUrl,
    client_reference_id: params.userId,
    ...(params.customerId
      ? { customer: params.customerId }
      : { customer_email: params.userEmail }),
    subscription_data: {
      metadata: {
        userId: params.userId,
      },
    },
  })
}

/** Creates a Stripe Billing Portal session. Throws on Stripe error. */
export async function createPortalSession(customerId: string, returnUrl: string): Promise<Stripe.BillingPortal.Session> {
  return stripe.billingPortal.sessions.create({ customer: customerId, return_url: returnUrl })
}

/** Updates the cancel_at_period_end flag on a Stripe subscription. Throws on Stripe error. */
export async function setSubscriptionCancelAtPeriodEnd(subscriptionId: string, cancel: boolean): Promise<void> {
  await stripe.subscriptions.update(subscriptionId, { cancel_at_period_end: cancel })
}

/** Immediately cancels an active subscription. No-op when already canceled or missing. */
export async function cancelSubscriptionImmediately(subscriptionId: string): Promise<void> {
  try {
    const sub = await stripe.subscriptions.retrieve(subscriptionId)
    if (sub.status !== 'canceled') {
      await stripe.subscriptions.cancel(subscriptionId)
    }
  } catch (error) {
    if (error instanceof Stripe.errors.StripeInvalidRequestError && error.code === 'resource_missing') {
      return
    }
    throw error
  }
}

export function isChargeFullyRefunded(
  charge: Pick<Stripe.Charge, 'refunded' | 'amount_refunded' | 'amount'>,
): boolean {
  return charge.refunded || (charge.amount > 0 && charge.amount_refunded >= charge.amount)
}

/** Keeps the Stripe customer email aligned with the app account email. */
export async function updateStripeCustomerEmail(customerId: string, email: string): Promise<void> {
  await stripe.customers.update(customerId, { email })
}

/** Deletes a Stripe customer when billing teardown allows it. */
export async function deleteStripeCustomer(customerId: string): Promise<void> {
  try {
    await stripe.customers.del(customerId)
  } catch (error) {
    if (error instanceof Stripe.errors.StripeInvalidRequestError && error.code === 'resource_missing') {
      return
    }
    throw error
  }
}

/** Cancels an abandoned incomplete subscription so the customer can start checkout again. */
export async function cancelAbandonedSubscription(subscriptionId: string): Promise<void> {
  try {
    const sub = await stripe.subscriptions.retrieve(subscriptionId)
    if (sub.status === 'incomplete') {
      await stripe.subscriptions.cancel(subscriptionId)
    }
  } catch (error) {
    if (error instanceof Stripe.errors.StripeInvalidRequestError && error.code === 'resource_missing') {
      return
    }
    throw error
  }
}
