import Stripe from 'stripe'
import type { SubscriptionInterval } from '@/generated/prisma'

/** Maps a Stripe billing interval string to the SubscriptionInterval enum value. */
export function stripeIntervalToEnum(interval?: string): SubscriptionInterval | undefined {
  if (interval === 'month') return 'month'
  if (interval === 'year') return 'year'
  return undefined
}

if (!process.env.STRIPE_SECRET_KEY) {
  throw new Error('STRIPE_SECRET_KEY is missing. Please set it in your .env file.')
}

/** Converts a Stripe Unix timestamp (seconds) to a JS Date (milliseconds). */
export function fromStripeTs(ts: number): Date {
  return new Date(ts * 1000)
}

export const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, {
  apiVersion: '2026-05-27.dahlia',
  appInfo: {
    name: 'DevStash Pro',
    version: '0.1.0',
  },
  typescript: true,
})

export interface LiveSubscriptionState {
  cancelAtPeriodEnd: boolean
  currentPeriodEnd: Date | null
  interval: SubscriptionInterval | null
}

export interface CheckoutSessionParams {
  priceId: string
  userId: string
  userEmail?: string
  successUrl: string
  cancelUrl: string
}

export interface SubscriptionOnCheckout {
  startDate: Date
  interval: SubscriptionInterval | undefined
}

export function getIntervalFromSub(sub: Stripe.Subscription): SubscriptionInterval | undefined {
  const raw = sub.items.data[0]?.price?.recurring?.interval
  return raw ? stripeIntervalToEnum(raw) : undefined
}

/** Fetches the authoritative subscription state from Stripe. Returns null on error. */
export async function fetchLiveSubscriptionState(subscriptionId: string): Promise<LiveSubscriptionState | null> {
  try {
    const sub = await stripe.subscriptions.retrieve(subscriptionId, {
      expand: ['items.data.price'],
    })
    const periodEnd = sub.items.data[0]?.current_period_end
    const isCanceling = sub.cancel_at_period_end || sub.cancel_at !== null || sub.canceled_at !== null
    return {
      cancelAtPeriodEnd: isCanceling,
      currentPeriodEnd: periodEnd ? fromStripeTs(periodEnd) : null,
      interval: getIntervalFromSub(sub) ?? null,
    }
  } catch {
    return null
  }
}

/** Fetches start date and billing interval for a newly created subscription. Returns null on error. */
export async function fetchSubscriptionOnCheckout(subscriptionId: string): Promise<SubscriptionOnCheckout | null> {
  try {
    const sub = await stripe.subscriptions.retrieve(subscriptionId, {
      expand: ['items.data.price'],
    })
    return {
      startDate: fromStripeTs(sub.start_date),
      interval: getIntervalFromSub(sub),
    }
  } catch {
    return null
  }
}

/** Creates a Stripe Checkout session for a subscription. Throws on Stripe error. */
export async function createCheckoutSession(params: CheckoutSessionParams): Promise<Stripe.Checkout.Session> {
  return stripe.checkout.sessions.create({
    mode: 'subscription',
    line_items: [{ price: params.priceId, quantity: 1 }],
    success_url: params.successUrl,
    cancel_url: params.cancelUrl,
    client_reference_id: params.userId,
    customer_email: params.userEmail,
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
