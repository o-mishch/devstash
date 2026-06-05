import { NextRequest } from 'next/server'
import { stripe, fromStripeTs } from '@/lib/stripe'
import {
  updateUserStripeSubscription,
  updateSubscriptionPeriodEnd,
  clearStripeSubscriptionBySubId,
} from '@/lib/db/stripe'
import { apiRoute, ApiResponse } from '@/lib/api'
import { createLogger } from '@/lib/logger'
import Stripe from 'stripe'

const log = createLogger('stripe-webhook')

export const POST = apiRoute(async (req: NextRequest) => {
  const body = await req.text() // MUST BE RAW TEXT
  const signature = req.headers.get('stripe-signature')

  if (!signature) {
    log.error('Webhook received with no stripe-signature header', { bodyLength: body.length })
    return ApiResponse.BAD_REQUEST('No signature found')
  }

  if (!process.env.STRIPE_WEBHOOK_SECRET) {
    log.error('STRIPE_WEBHOOK_SECRET is not configured', { body })
    return ApiResponse.INTERNAL_ERROR('Webhook secret not configured')
  }

  let event: Stripe.Event
  try {
    event = stripe.webhooks.constructEvent(
      body,
      signature,
      process.env.STRIPE_WEBHOOK_SECRET
    )
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    log.error(`Webhook signature verification failed: ${message}`, { body })
    return ApiResponse.BAD_REQUEST('Invalid signature')
  }

  switch (event.type) {
    case 'checkout.session.completed':
      await handleCheckoutSessionCompleted(event.data.object as Stripe.Checkout.Session)
      break
    case 'customer.subscription.deleted':
      await handleSubscriptionDeleted(event.data.object as Stripe.Subscription)
      break
    case 'customer.subscription.updated':
      await handleSubscriptionUpdated(event.data.object as Stripe.Subscription)
      break
    case 'invoice.payment_failed':
      handleInvoicePaymentFailed(event.data.object as Stripe.Invoice)
      break
    case 'invoice.paid':
      await handleInvoicePaid(event.data.object as Stripe.Invoice)
      break
    default:
      log.warn(`Unhandled event type ${event.type}`)
  }

  return ApiResponse.OK({ received: true })
})

async function handleCheckoutSessionCompleted(session: Stripe.Checkout.Session) {
  const userId = session.client_reference_id
  if (!userId) {
    log.warn('checkout.session.completed: no client_reference_id, skipping')
    return
  }
  const customerId = typeof session.customer === 'string' ? session.customer : null
  const subscriptionId = typeof session.subscription === 'string' ? session.subscription : null
  if (!customerId || !subscriptionId) {
    log.warn(`checkout.session.completed: missing customer or subscription for user:${userId}`)
    return
  }

  // Retrieve subscription once (background webhook, not user request path) to get start_date.
  // currentPeriodEnd is populated by invoice.paid which fires alongside this event.
  let subscriptionStart: Date | undefined
  try {
    const sub = await stripe.subscriptions.retrieve(subscriptionId)
    subscriptionStart = fromStripeTs(sub.start_date)
  } catch {
    log.warn('checkout.session.completed: failed to retrieve subscription start_date')
  }

  await updateUserStripeSubscription(userId, customerId, subscriptionId, true, subscriptionStart)
  log.info(`Upgraded user ${userId} to Pro`)
}

async function handleSubscriptionDeleted(subscription: Stripe.Subscription) {
  const periodEnd = subscription.items.data[0]?.current_period_end
  await clearStripeSubscriptionBySubId(subscription.id, periodEnd ? fromStripeTs(periodEnd) : undefined)
  log.info(`Downgraded subscription ${subscription.id}`)
}

async function handleSubscriptionUpdated(subscription: Stripe.Subscription) {
  // Safety net: if Stripe marks subscription canceled/unpaid via an update,
  // downgrade the user even if the `deleted` event hasn't arrived yet.
  if (subscription.status === 'canceled' || subscription.status === 'unpaid') {
    const periodEnd = subscription.items.data[0]?.current_period_end
    await clearStripeSubscriptionBySubId(subscription.id, periodEnd ? fromStripeTs(periodEnd) : undefined)
    log.info(`Downgraded subscription ${subscription.id} via status=${subscription.status}`)
  } else {
    log.info(`Subscription ${subscription.id} updated, status=${subscription.status}`)
  }
}

function handleInvoicePaymentFailed(invoice: Stripe.Invoice) {
  // Do not downgrade immediately on payment failure — Stripe will retry and
  // eventually cancel the subscription (handled by customer.subscription.deleted).
  log.warn(`Payment failed for invoice ${invoice.id}`)
}

async function handleInvoicePaid(invoice: Stripe.Invoice) {
  // invoice.parent.subscription_details.subscription holds the subscription ID in Stripe v22
  const subscriptionRef = invoice.parent?.subscription_details?.subscription
  const subscriptionId = typeof subscriptionRef === 'string'
    ? subscriptionRef
    : subscriptionRef?.id ?? null
  if (subscriptionId && invoice.period_end) {
    await updateSubscriptionPeriodEnd(subscriptionId, fromStripeTs(invoice.period_end))
  }
  log.info(`Invoice ${invoice.id} paid, subscription renewed`)
}
