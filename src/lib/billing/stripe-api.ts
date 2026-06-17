import 'server-only'

import Stripe from 'stripe'
import type { SubscriptionInterval } from '@/generated/prisma'
import { getAllowedCheckoutPriceIds } from '@/lib/billing/config/billing-pricing'
import { isSubscriptionCanceling } from '@/lib/billing/subscription/subscription-access'
import { stripe } from '@/lib/infra/stripe'
import { fromStripeTs, stripeIntervalToEnum } from '@/lib/billing/stripe-utils'
import { logger } from '@/lib/infra/pino'

const log = logger.child({ tag: 'stripe-api' })

const CUSTOMER_SUBSCRIPTIONS_PAGE_SIZE = 100

export function getStripeCustomerId(
  customer: Stripe.Customer | Stripe.DeletedCustomer | string | null | undefined,
): string | null {
  if (!customer) return null
  return typeof customer === 'string' ? customer : customer.id
}

export interface StripeSubscriptionDetails {
  customerId: string | null
  startDate: Date
  currentPeriodEnd: Date | null
  interval: SubscriptionInterval | undefined
  status: Stripe.Subscription.Status
  userId: string | null
  cancelAtPeriodEnd: boolean
}

/** Picks the DevStash plan item when a subscription has multiple line items. */
export function getPrimarySubscriptionItem(sub: Stripe.Subscription): Stripe.SubscriptionItem | undefined {
  const allowedPriceIds = getAllowedCheckoutPriceIds()
  if (allowedPriceIds.size > 0) {
    const planItem = sub.items.data.find((item) => allowedPriceIds.has(item.price?.id ?? ''))
    if (planItem) return planItem
  }

  return sub.items.data.find((item) => item.price?.recurring) ?? sub.items.data[0]
}

export function getIntervalFromSub(sub: Stripe.Subscription): SubscriptionInterval | undefined {
  const raw = getPrimarySubscriptionItem(sub)?.price?.recurring?.interval
  return raw ? stripeIntervalToEnum(raw) : undefined
}

/** Maps a Stripe subscription object to the local billing details shape. */
export function mapSubscriptionToDetails(sub: Stripe.Subscription): StripeSubscriptionDetails {
  const periodEnd = getPrimarySubscriptionItem(sub)?.current_period_end
  return {
    customerId: typeof sub.customer === 'string' ? sub.customer : sub.customer?.id ?? null,
    startDate: fromStripeTs(sub.start_date),
    currentPeriodEnd: periodEnd ? fromStripeTs(periodEnd) : null,
    interval: getIntervalFromSub(sub),
    status: sub.status,
    userId: typeof sub.metadata?.userId === 'string' ? sub.metadata.userId : null,
    cancelAtPeriodEnd: isSubscriptionCanceling(sub),
  }
}

export interface LiveSubscriptionState {
  exists: boolean
  cancelAtPeriodEnd: boolean
  currentPeriodEnd: Date | null
  interval: SubscriptionInterval | null
  status: Stripe.Subscription.Status | null
}

export interface StripeCheckoutSessionDetails {
  customerId: string | null
  paymentStatus: Stripe.Checkout.Session['payment_status'] | null
  subscriptionId: string | null
  userId: string | null
}

type RetrieveSubscriptionResult =
  | { status: 'ok'; subscription: Stripe.Subscription }
  | { status: 'missing' }
  | { status: 'error' }

async function retrieveExpandedSubscription(subscriptionId: string): Promise<RetrieveSubscriptionResult> {
  try {
    const subscription = await stripe.subscriptions.retrieve(subscriptionId, {
      expand: ['items.data.price'],
    })
    return { status: 'ok', subscription }
  } catch (error) {
    if (error instanceof Stripe.errors.StripeInvalidRequestError && error.code === 'resource_missing') {
      return { status: 'missing' }
    }
    log.error({ subscriptionId, err: error }, 'Failed to retrieve subscription from Stripe')
    return { status: 'error' }
  }
}

/** Fetches the authoritative subscription state from Stripe. Returns null on error. */
export async function fetchLiveSubscriptionState(subscriptionId: string): Promise<LiveSubscriptionState | null> {
  const result = await retrieveExpandedSubscription(subscriptionId)
  if (result.status === 'missing') {
    return {
      exists: false,
      cancelAtPeriodEnd: false,
      currentPeriodEnd: null,
      interval: null,
      status: null,
    }
  }
  if (result.status === 'error') return null

  const sub = result.subscription
  const primaryItem = getPrimarySubscriptionItem(sub)
  const periodEnd = primaryItem?.current_period_end
  return {
    exists: true,
    cancelAtPeriodEnd: isSubscriptionCanceling(sub),
    currentPeriodEnd: periodEnd ? fromStripeTs(periodEnd) : null,
    interval: getIntervalFromSub(sub) ?? null,
    status: sub.status,
  }
}

/** Fetches the current Stripe subscription details needed for local billing state. Returns null on error. */
export async function fetchSubscriptionDetails(subscriptionId: string): Promise<StripeSubscriptionDetails | null> {
  const result = await retrieveExpandedSubscription(subscriptionId)
  if (result.status === 'error') return null
  if (result.status === 'missing') return null
  return mapSubscriptionToDetails(result.subscription)
}

export async function fetchCheckoutSessionDetails(sessionId: string): Promise<StripeCheckoutSessionDetails | null> {
  try {
    const session = await stripe.checkout.sessions.retrieve(sessionId, {
      expand: ['subscription'],
    })

    const expandedSubscription =
      typeof session.subscription === 'object' && session.subscription !== null
        ? session.subscription
        : null

    const userIdFromSubscription =
      expandedSubscription && 'metadata' in expandedSubscription && typeof expandedSubscription.metadata.userId === 'string'
        ? expandedSubscription.metadata.userId
        : null

    return {
      customerId: getStripeCustomerId(session.customer),
      paymentStatus: session.payment_status,
      subscriptionId: typeof session.subscription === 'string' ? session.subscription : session.subscription?.id ?? null,
      userId: session.client_reference_id ?? userIdFromSubscription,
    }
  } catch (error) {
    log.error({ sessionId, err: error }, 'Failed to fetch checkout session details from Stripe')
    return null
  }
}

type RetrieveStripeCustomerResult =
  | { status: 'ok'; customer: Stripe.Customer }
  | { status: 'deleted' }
  | { status: 'error' }

/** Retrieves a Stripe customer by ID. Returns null on error or when deleted. */
export async function retrieveStripeCustomer(customerId: string): Promise<Stripe.Customer | null> {
  const result = await retrieveStripeCustomerResult(customerId)
  if (result.status === 'ok') return result.customer
  return null
}

async function retrieveStripeCustomerResult(customerId: string): Promise<RetrieveStripeCustomerResult> {
  try {
    const customer = await stripe.customers.retrieve(customerId)
    if ('deleted' in customer && customer.deleted) return { status: 'deleted' }
    return { status: 'ok', customer }
  } catch (error) {
    log.warn({ customerId, err: error }, 'Failed to retrieve Stripe customer')
    return { status: 'error' }
  }
}

/** Lists Stripe customers by email address. */
export async function listStripeCustomersByEmail(email: string): Promise<Stripe.Customer[]> {
  const customers = stripe.customers.list({ email, limit: 100 })
  const customerList: Stripe.Customer[] = []
  for await (const customer of customers) {
    if ('deleted' in customer && customer.deleted) continue
    customerList.push(customer)
  }
  return customerList
}

/**
 * Iterates every subscription for a Stripe customer.
 * The Stripe Node SDK auto-paginates list requests; `limit` is the page size, not a cap.
 */
export async function* iterateCustomerSubscriptions(
  customerId: string,
): AsyncGenerator<Stripe.Subscription> {
  const subscriptions = stripe.subscriptions.list({
    customer: customerId,
    status: 'all',
    limit: CUSTOMER_SUBSCRIPTIONS_PAGE_SIZE,
  })

  for await (const subscription of subscriptions) {
    yield subscription
  }
}

/** Retrieves a Stripe charge by ID. Returns null on error. */
export async function retrieveStripeCharge(chargeId: string): Promise<Stripe.Charge | null> {
  try {
    return await stripe.charges.retrieve(chargeId)
  } catch (error) {
    log.warn({ chargeId, err: error }, 'Failed to retrieve Stripe charge')
    return null
  }
}

/** Retrieves a Stripe invoice by ID. Returns null on error. */
export async function retrieveStripeInvoice(invoiceId: string): Promise<Stripe.Invoice | null> {
  try {
    return await stripe.invoices.retrieve(invoiceId)
  } catch (error) {
    log.warn({ invoiceId, err: error }, 'Failed to retrieve Stripe invoice')
    return null
  }
}

/** Lists configured Stripe webhook endpoints. */
export async function listStripeWebhookEndpoints(): Promise<Stripe.WebhookEndpoint[]> {
  const endpoints = await stripe.webhookEndpoints.list({ limit: 100 })
  return endpoints.data
}

