import { NextRequest } from 'next/server'
import { stripe, fromStripeTs, fetchSubscriptionOnCheckout, getIntervalFromSub } from '@/lib/stripe'
import {
  updateUserStripeSubscription,
  updateSubscriptionState,
  clearStripeSubscriptionBySubId,
} from '@/lib/db/stripe'
import { apiRoute, ApiResponse } from '@/lib/api'
import { createLogger } from '@/lib/logger'
import Stripe from 'stripe'
import type { SubscriptionInterval } from '@/generated/prisma'

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
    log.error(`Webhook signature verification failed`, { error: String(err) })
    return ApiResponse.BAD_REQUEST('Invalid signature')
  }

  // Critical — state mutations that update the DB
  switch (event.type) {
    case 'checkout.session.completed':
      await handleCheckoutSessionCompleted(event.data.object as Stripe.Checkout.Session)
      break
    case 'customer.subscription.updated':
      await handleSubscriptionUpdated(event.data.object as Stripe.Subscription)
      break
    case 'customer.subscription.deleted':
      await handleSubscriptionDeleted(event.data.object as Stripe.Subscription)
      break
    case 'invoice.payment_failed': {
      const failedInvoice = event.data.object as Stripe.Invoice
      log.warn(`invoice.payment_failed → payment failed`, { eventId: event.id, invoiceId: failedInvoice.id, customerId: failedInvoice.customer })
      break
    }
    case 'invoice.paid':
      await handleInvoicePaid(event.data.object as Stripe.Invoice)
      break

    // Informational only — logged but no DB mutations
    case 'invoice.payment_succeeded': {
      const inv = event.data.object as Stripe.Invoice
      log.info(`invoice.payment_succeeded → payment captured (renewal handled by invoice.paid)`, { eventId: event.id, invoiceId: inv.id, customerId: inv.customer })
      break
    }
    case 'customer.created': {
      const customer = event.data.object as Stripe.Customer
      log.info(`customer.created → customer record created`, { eventId: event.id, customerId: customer.id, email: customer.email })
      break
    }
    case 'customer.updated': {
      const customer = event.data.object as Stripe.Customer
      log.info(`customer.updated → customer record updated`, { eventId: event.id, customerId: customer.id })
      break
    }
    case 'customer.subscription.created': {
      const sub = event.data.object as Stripe.Subscription
      log.info(`customer.subscription.created → subscription object created`, { eventId: event.id, subscriptionId: sub.id, customerId: typeof sub.customer === 'string' ? sub.customer : sub.customer?.id })
      break
    }
    case 'payment_method.attached': {
      const pm = event.data.object as Stripe.PaymentMethod
      log.info(`payment_method.attached → payment method attached to customer`, { eventId: event.id, paymentMethodId: pm.id, customerId: pm.customer, type: pm.type })
      break
    }
    case 'payment_intent.created': {
      const pi = event.data.object as Stripe.PaymentIntent
      log.info(`payment_intent.created → PaymentIntent instantiated`, { eventId: event.id, paymentIntentId: pi.id, amount: pi.amount, currency: pi.currency })
      break
    }
    case 'payment_intent.succeeded': {
      const pi = event.data.object as Stripe.PaymentIntent
      log.info(`payment_intent.succeeded → funds captured`, { eventId: event.id, paymentIntentId: pi.id, amount: pi.amount, currency: pi.currency })
      break
    }
    case 'invoice.created': {
      const inv = event.data.object as Stripe.Invoice
      log.info(`invoice.created → invoice draft generated`, { eventId: event.id, invoiceId: inv.id, customerId: inv.customer })
      break
    }
    case 'invoice.finalized': {
      const inv = event.data.object as Stripe.Invoice
      log.info(`invoice.finalized → invoice finalized and sent to customer`, { eventId: event.id, invoiceId: inv.id, customerId: inv.customer, amountDue: inv.amount_due })
      break
    }
    case 'billing_portal.session.created': {
      const portalSession = event.data.object as Stripe.BillingPortal.Session
      log.info(`billing_portal.session.created → customer opened billing portal`, { eventId: event.id, customerId: portalSession.customer })
      break
    }
    case 'invoice_payment.paid': {
      const invPayment = event.data.object as Stripe.InvoicePayment
      log.info(`invoice_payment.paid → InvoicePayment transitioned to paid`, { eventId: event.id, invoicePaymentId: invPayment.id })
      break
    }
    case 'charge.succeeded': {
      const charge = event.data.object as Stripe.Charge
      log.info(`charge.succeeded → charge captured`, { eventId: event.id, chargeId: charge.id, customerId: charge.customer, amount: charge.amount, currency: charge.currency })
      break
    }
    default:
      log.warn(`unhandled event type: ${event.type}`, { eventId: event.id })
  }

  return ApiResponse.OK({ received: true })
})


async function handleCheckoutSessionCompleted(session: Stripe.Checkout.Session) {
  try {
    const userId = session.client_reference_id
    if (!userId) {
      log.warn('No client_reference_id on checkout session, skipping')
      return
    }
    const customerId = typeof session.customer === 'string' ? session.customer : null
    const subscriptionId = typeof session.subscription === 'string' ? session.subscription : null
    if (!customerId || !subscriptionId) {
      log.warn(`Missing customer or subscription for user:${userId}`)
      return
    }

    // Retrieve subscription to get start_date and billing interval.
    // currentPeriodEnd is populated by invoice.paid which fires alongside this event.
    let subscriptionStart: Date | undefined
    let subscriptionInterval: SubscriptionInterval | undefined
    const subInfo = await fetchSubscriptionOnCheckout(subscriptionId)
    if (subInfo) {
      subscriptionStart = subInfo.startDate
      subscriptionInterval = subInfo.interval
    } else {
      log.warn('Failed to retrieve subscription details')
    }

    await updateUserStripeSubscription(userId, {
      stripeCustomerId: customerId,
      stripeSubscriptionId: subscriptionId,
      isPro: true,
      subscriptionStart,
      subscriptionInterval,
    })
    log.info(`checkout.session.completed → user:${userId} upgraded to Pro`, { subscriptionId, interval: subscriptionInterval ?? 'unknown', startedAt: subscriptionStart?.toISOString() ?? 'unknown' })
  } catch (error) {
    log.error('Error in handleCheckoutSessionCompleted', { error: String(error) })
    throw error
  }
}

async function handleSubscriptionDeleted(subscription: Stripe.Subscription) {
  try {
    const periodEnd = subscription.items.data[0]?.current_period_end
    const periodEndDate = periodEnd ? fromStripeTs(periodEnd) : undefined
    await clearStripeSubscriptionBySubId(subscription.id, periodEndDate)
    log.info(`customer.subscription.deleted → subscription:${subscription.id} removed, Pro access ends`, { endsAt: periodEndDate?.toISOString() ?? 'immediately' })
  } catch (error) {
    log.error('Error in handleSubscriptionDeleted', { error: String(error) })
    throw error
  }
}

async function handleSubscriptionUpdated(subscription: Stripe.Subscription) {
  try {
    const item = subscription.items.data[0]
    const periodEnd = item?.current_period_end
    const periodEndDate = periodEnd ? fromStripeTs(periodEnd) : null

    // Safety net: if Stripe marks subscription canceled/unpaid, downgrade the user
    // even if the `deleted` event hasn't arrived yet.
    if (subscription.status === 'canceled' || subscription.status === 'unpaid') {
      await clearStripeSubscriptionBySubId(subscription.id, periodEndDate ?? undefined)
      log.warn(`customer.subscription.updated → subscription:${subscription.id} downgraded due to status`, { status: subscription.status, accessEndsAt: periodEndDate?.toISOString() ?? 'immediately' })
      return
    }

    const interval = getIntervalFromSub(subscription)
    const isCanceling = subscription.cancel_at_period_end || subscription.cancel_at !== null || subscription.canceled_at !== null

    await updateSubscriptionState(subscription.id, {
      cancelAtPeriodEnd: isCanceling,
      ...(interval && { subscriptionInterval: interval }),
      ...(periodEndDate && { currentPeriodEnd: periodEndDate }),
    })

    if (isCanceling) {
      log.info(`customer.subscription.updated → subscription:${subscription.id} scheduled to cancel at period end`, { accessEndsAt: periodEndDate?.toISOString() ?? 'unknown', interval: interval ?? 'unknown' })
    } else {
      log.info(`customer.subscription.updated → subscription:${subscription.id} active (reactivated or renewed)`, { interval: interval ?? 'unknown', currentPeriodEndsAt: periodEndDate?.toISOString() ?? 'unknown' })
    }
  } catch (error) {
    log.error('Error in handleSubscriptionUpdated', { error: String(error) })
    throw error
  }
}

async function handleInvoicePaid(invoice: Stripe.Invoice) {
  try {
    // invoice.parent.subscription_details.subscription holds the subscription ID in Stripe v22
    const subscriptionRef = invoice.parent?.subscription_details?.subscription
    const subscriptionId = typeof subscriptionRef === 'string'
      ? subscriptionRef
      : subscriptionRef?.id ?? null
    if (subscriptionId && invoice.period_end) {
      const newPeriodEnd = fromStripeTs(invoice.period_end)
      await updateSubscriptionState(subscriptionId, { currentPeriodEnd: newPeriodEnd })
      log.info(`invoice.paid → subscription:${subscriptionId} renewed, next period updated`, { invoiceId: invoice.id, newPeriodEndsAt: newPeriodEnd.toISOString() })
    } else {
      log.warn(`invoice.paid → skipped period update, missing subscription ID or period_end`, { invoiceId: invoice.id })
    }
  } catch (error) {
    log.error('Error in handleInvoicePaid', { error: String(error) })
    throw error
  }
}
