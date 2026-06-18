import 'server-only'

import type Stripe from 'stripe'
import { logger } from '@/lib/infra/pino'
import { cancelAbandonedSubscription, cancelSubscriptionImmediately, isChargeFullyRefunded } from '@/lib/infra/stripe'
import { fromStripeTs } from '@/lib/billing/stripe-utils'
import {
  fetchSubscriptionDetails,
  getPrimarySubscriptionItem,
  getStripeCustomerId,
  retrieveStripeCharge,
  retrieveStripeCustomer,
  retrieveStripeInvoice,
} from '@/lib/billing/stripe-api'
import { getStripeEventDescription } from '@/lib/billing/config/billing-config'
import { sendBillingCheckoutPaymentFailedEmail } from '@/lib/billing/emails/billing-checkout-payment-failed'
import { sendBillingPaymentFailedEmail } from '@/lib/billing/emails/billing-payment-failed'
import { sendBillingTrialEndingEmail } from '@/lib/billing/emails/billing-trial-ending'
import { sendBillingDisputeAdminEmail } from '@/lib/billing/emails/billing-dispute-admin'
import { createPortalSession } from '@/lib/infra/stripe'
import type { EmailSendResult } from '@/lib/infra/resend'
import { resolveAppUserIdForSubscription } from '@/lib/billing/subscription/subscription-state'
import {
  isSubscriptionUpsertEvent,
  upsertSubscriptionStateFromObject,
  type SubscriptionUpsertSourceEvent,
} from '@/lib/billing/subscription/stripe-subscription-persist'
import { getBaseUrl } from '@/lib/utils/url'
import { subscriptionHasProAccess } from '@/lib/billing/subscription/subscription-access'
import {
  applySubscriptionStateWithBackfill,
  persistSubscriptionFromStripe,
  reconcileSubscriptionById,
} from '@/lib/billing/subscription/stripe-subscription-persist'
import {
  clearStripeCustomerByCustomerId,
  clearStripeSubscriptionBySubId,
} from '@/lib/billing/subscription/subscription-state'
import { getUserIdByStripeCustomerId } from '@/lib/db/stripe'
import { getUserById } from '@/lib/db/users'

const logCheckout = logger.child({ tag: 'stripe-webhook-checkout' })
const logCharge = logger.child({ tag: 'stripe-webhook-charge' })
const logInvoice = logger.child({ tag: 'stripe-webhook-invoice' })
const logSubscription = logger.child({ tag: 'stripe-webhook-subscription' })
const logCustomer = logger.child({ tag: 'stripe-webhook-customer' })
const logRecovery = logger.child({ tag: 'billing-recovery-email' })

// ─── Invoice subscription resolution (formerly stripe-invoice.ts) ───────────────

function subscriptionRefToId(
  subscriptionRef: string | Stripe.Subscription | null | undefined,
): string | null {
  if (!subscriptionRef) return null
  return typeof subscriptionRef === 'string' ? subscriptionRef : subscriptionRef.id
}

type ChargeWithLegacyInvoice = Stripe.Charge & {
  invoice?: string | Stripe.Invoice | null
}

function getSubscriptionIdFromLineItem(line: Stripe.InvoiceLineItem): string | null {
  const fromSubscriptionItem = subscriptionRefToId(
    line.parent?.subscription_item_details?.subscription ?? undefined,
  )
  if (fromSubscriptionItem) return fromSubscriptionItem

  const fromInvoiceItem = line.parent?.invoice_item_details?.subscription
  if (fromInvoiceItem) return fromInvoiceItem

  const legacyLineSubscription = (line as Stripe.InvoiceLineItem & {
    subscription?: string | Stripe.Subscription | null
  }).subscription
  return subscriptionRefToId(legacyLineSubscription)
}

export function getSubscriptionIdFromInvoice(invoice: Stripe.Invoice): string | null {
  const parentSubscription = invoice.parent?.subscription_details?.subscription
  const fromParent = subscriptionRefToId(parentSubscription)
  if (fromParent) return fromParent

  const legacySubscription = (invoice as Stripe.Invoice & {
    subscription?: string | Stripe.Subscription | null
  }).subscription
  const fromLegacy = subscriptionRefToId(legacySubscription)
  if (fromLegacy) return fromLegacy

  for (const line of invoice.lines?.data ?? []) {
    const fromLine = getSubscriptionIdFromLineItem(line)
    if (fromLine) return fromLine
  }

  return null
}

async function fetchInvoiceSubscriptionId(invoiceId: string): Promise<string | null> {
  const invoice = await retrieveStripeInvoice(invoiceId)
  if (!invoice) return null
  return getSubscriptionIdFromInvoice(invoice)
}

export async function resolveSubscriptionIdFromCharge(charge: Stripe.Charge): Promise<string | null> {
  const invoice = (charge as ChargeWithLegacyInvoice).invoice
  if (typeof invoice === 'object' && invoice !== null) {
    return getSubscriptionIdFromInvoice(invoice)
  }
  if (typeof invoice === 'string') {
    return fetchInvoiceSubscriptionId(invoice)
  }
  return null
}

// ─── Checkout handlers ────────────────────────────────────────────────────────

export async function handleCheckoutSessionCompleted(session: Stripe.Checkout.Session, forceActivate: boolean) {
  if (session.mode !== 'subscription') {
    logCheckout.warn(
      {
        sessionId: session.id,
        mode: session.mode,
      },
      'Ignoring checkout session that is not a subscription checkout',
    )
    return
  }

  const subscriptionId = typeof session.subscription === 'string' ? session.subscription : null
  if (!subscriptionId) {
    throw new Error(
      `Missing subscription on checkout session ${session.id} — retrying until Stripe attaches it`,
    )
  }

  const customerId = getStripeCustomerId(session.customer)
  const details = await fetchSubscriptionDetails(subscriptionId)
  const userId = session.client_reference_id
    ?? await resolveAppUserIdForSubscription({
      customerId,
      subscriptionUserId: details?.userId ?? null,
    })
  if (!userId) {
    throw new Error(
      `Could not resolve app user for checkout session ${session.id} (subscription ${subscriptionId})`,
    )
  }

  const persistResult = await persistSubscriptionFromStripe(
    userId,
    subscriptionId,
    customerId,
    forceActivate,
    session.payment_status,
  )
  if (!persistResult.persisted) {
    throw new Error(
      `Failed to persist subscription ${subscriptionId} for user ${userId} after checkout`,
    )
  }
}

function getCheckoutSessionCustomerEmail(session: Stripe.Checkout.Session): string | null {
  return session.customer_details?.email ?? session.customer_email ?? null
}

async function sendCheckoutPaymentFailedEmail(session: Stripe.Checkout.Session): Promise<void> {
  await sendBillingPortalRecoveryEmail({
    sourceEvent: 'checkout.session.async_payment_failed',
    customerId: getStripeCustomerId(session.customer),
    email: getCheckoutSessionCustomerEmail(session),
    contextId: session.id,
    missingFieldsMessage: 'checkout payment failure email could not be sent because customer ID or email was missing',
    missingPortalUrlMessage: 'checkout payment failure email could not be sent because portal session URL was missing',
    successMessage: 'async checkout payment failed and customer notification was sent',
    failureMessage: 'async checkout payment failed and customer notification could not be sent',
    sendEmail: ({ portalUrl, to }) => sendBillingCheckoutPaymentFailedEmail({
      sessionId: session.id,
      portalUrl,
      to,
    }),
  })
}

export async function handleAbandonedCheckoutSession(
  session: Stripe.Checkout.Session,
  eventType: 'checkout.session.async_payment_failed' | 'checkout.session.expired',
  description: string,
) {
  if (eventType === 'checkout.session.async_payment_failed') {
    await sendCheckoutPaymentFailedEmail(session)
  }

  const subscriptionId = typeof session.subscription === 'string'
    ? session.subscription
    : session.subscription?.id ?? null

  if (subscriptionId) {
    await cancelAbandonedSubscription(subscriptionId)
    const details = await fetchSubscriptionDetails(subscriptionId)
    await clearStripeSubscriptionBySubId(subscriptionId, details?.currentPeriodEnd ?? undefined)
  }

  logCheckout.warn(
    {
      sessionId: session.id,
      subscriptionId,
      customerId: getStripeCustomerId(session.customer),
    },
    `${eventType} — ${description}`,
  )
}

// ─── Charge handlers ──────────────────────────────────────────────────────────

async function revokeSubscriptionAccessLocally(subscriptionId: string): Promise<void> {
  const details = await reconcileSubscriptionById(subscriptionId)
  if (!details) {
    throw new Error(
      `charge handler could not reconcile subscription ${subscriptionId}`,
    )
  }
  if (subscriptionHasProAccess(details.status)) {
    await cancelSubscriptionImmediately(subscriptionId)
    await clearStripeSubscriptionBySubId(subscriptionId, details.currentPeriodEnd ?? undefined)
  }
}

export async function handleChargeRefunded(charge: Stripe.Charge) {
  const subscriptionId = await resolveSubscriptionIdFromCharge(charge)
  if (!subscriptionId) {
    logCharge.warn({ chargeId: charge.id }, 'charge.refunded — no linked subscription found for refunded charge')
    return
  }

  if (isChargeFullyRefunded(charge)) {
    await revokeSubscriptionAccessLocally(subscriptionId)
    logCharge.warn(
      {
        chargeId: charge.id,
        subscriptionId,
        amountRefunded: charge.amount_refunded,
        revokedAccess: true,
      },
      'charge.refunded — full refund received — subscription reconciled and local Pro access revoked when still entitled',
    )
    return
  }

  const details = await reconcileSubscriptionById(subscriptionId)
  if (!details) {
    throw new Error(
      `charge.refunded could not reconcile subscription ${subscriptionId} (charge ${charge.id})`,
    )
  }
  logCharge.info(
    {
      chargeId: charge.id,
      subscriptionId,
      amountRefunded: charge.amount_refunded,
      subscriptionStatus: details.status,
      accessRetained: subscriptionHasProAccess(details.status),
    },
    `charge.refunded — ${getStripeEventDescription('charge.refunded')}`,
  )
}

export async function handleChargeDisputeCreated(dispute: Stripe.Dispute) {
  const chargeId = typeof dispute.charge === 'string' ? dispute.charge : dispute.charge?.id ?? null
  let subscriptionId: string | null = null
  if (chargeId) {
    const charge = await retrieveStripeCharge(chargeId)
    if (!charge) {
      throw new Error(
        `charge.dispute.created could not retrieve charge ${chargeId} (dispute ${dispute.id})`,
      )
    }
    subscriptionId = await resolveSubscriptionIdFromCharge(charge)
    if (subscriptionId) {
      const details = await reconcileSubscriptionById(subscriptionId)
      if (!details) {
        throw new Error(
          `charge.dispute.created could not reconcile subscription ${subscriptionId} (dispute ${dispute.id})`,
        )
      }
    }
  }

  const amount = `${(dispute.amount / 100).toFixed(2)} ${dispute.currency.toUpperCase()}`
  const emailSent = await sendBillingDisputeAdminEmail({
    disputeId: dispute.id,
    chargeId,
    subscriptionId,
    amount,
    reason: dispute.reason,
  })

  logCharge.warn(
    {
      disputeId: dispute.id,
      chargeId,
      subscriptionId,
      amount: dispute.amount,
      reason: dispute.reason,
      status: dispute.status,
      adminEmailSent: emailSent,
    },
    `charge.dispute.created — ${getStripeEventDescription('charge.dispute.created')}`,
  )
}

export async function handleChargeDisputeClosed(dispute: Stripe.Dispute) {
  const chargeId = typeof dispute.charge === 'string' ? dispute.charge : dispute.charge?.id ?? null
  if (!chargeId) {
    logCharge.warn({ disputeId: dispute.id }, 'charge.dispute.closed — dispute had no charge reference')
    return
  }

  const charge = await retrieveStripeCharge(chargeId)
  if (!charge) {
    throw new Error(
      `charge.dispute.closed could not retrieve charge ${chargeId} (dispute ${dispute.id})`,
    )
  }
  const subscriptionId = await resolveSubscriptionIdFromCharge(charge)

  if (dispute.status === 'lost') {
    if (subscriptionId) {
      await revokeSubscriptionAccessLocally(subscriptionId)
      logCharge.warn(
        {
          disputeId: dispute.id,
          chargeId,
          subscriptionId,
          revokedAccess: true,
        },
        'charge.dispute.closed — dispute lost — subscription reconciled and local Pro access revoked when still entitled',
      )
      return
    }
  }

  if (dispute.status === 'won' && subscriptionId) {
    const details = await reconcileSubscriptionById(subscriptionId)
    if (!details) {
      throw new Error(
        `charge.dispute.closed could not reconcile subscription ${subscriptionId} (dispute ${dispute.id})`,
      )
    }
    logCharge.info(
      {
        disputeId: dispute.id,
        chargeId,
        subscriptionId,
        subscriptionStatus: details?.status ?? 'unknown',
        restoredAccess: details ? subscriptionHasProAccess(details.status) : false,
      },
      'charge.dispute.closed — dispute won — subscription state reconciled from Stripe',
    )
    return
  }

  logCharge.info(
    {
      disputeId: dispute.id,
      chargeId,
      status: dispute.status,
    },
    `charge.dispute.closed — ${getStripeEventDescription('charge.dispute.closed')}`,
  )
}

// ─── Invoice handlers ─────────────────────────────────────────────────────────

async function sendBillingRecoveryEmail(
  invoice: Stripe.Invoice,
  sourceEvent: 'invoice.payment_failed' | 'invoice.payment_action_required' | 'invoice.payment_attempt_required',
): Promise<void> {
  const successMessage = sourceEvent === 'invoice.payment_failed'
    ? 'renewal payment failed and billing recovery email was sent'
    : 'billing recovery email was sent'
  const failureMessage = sourceEvent === 'invoice.payment_failed'
    ? 'renewal payment failed and billing recovery email could not be sent'
    : 'billing recovery email could not be sent'

  await sendBillingPortalRecoveryEmail({
    sourceEvent,
    customerId: getStripeCustomerId(invoice.customer),
    email: invoice.customer_email,
    contextId: invoice.id ?? 'unknown',
    successMessage,
    failureMessage,
    sendEmail: ({ portalUrl, to }) => sendBillingPaymentFailedEmail({
      invoiceId: invoice.id!,
      portalUrl,
      to,
    }),
  })
}

export async function handleInvoiceBillingRecovery(
  invoice: Stripe.Invoice,
  sourceEvent: 'invoice.payment_failed' | 'invoice.payment_action_required' | 'invoice.payment_attempt_required',
) {
  const subscriptionId = getSubscriptionIdFromInvoice(invoice)
  if (subscriptionId) {
    await reconcileSubscriptionById(subscriptionId)
  }
  await sendBillingRecoveryEmail(invoice, sourceEvent)
}

export async function handleInvoicePaid(invoice: Stripe.Invoice) {
  const subscriptionId = getSubscriptionIdFromInvoice(invoice)
  if (!subscriptionId) {
    logInvoice.warn({ invoiceId: invoice.id }, 'invoice.paid — skipped period update because subscription ID was missing')
    return
  }

  const subscription = await fetchSubscriptionDetails(subscriptionId)
  if (!subscription) {
    throw new Error(
      `invoice.paid could not fetch subscription ${subscriptionId} (invoice ${invoice.id})`,
    )
  }

  if (!subscriptionHasProAccess(subscription.status)) {
    await reconcileSubscriptionById(subscriptionId)
    logInvoice.warn(
      { invoiceId: invoice.id, subscriptionId, status: subscription.status },
      'invoice.paid — skipped Pro grant because subscription status does not entitle access',
    )
    return
  }

  let newPeriodEnd = invoice.period_end ? fromStripeTs(invoice.period_end) : null
  if (!newPeriodEnd) {
    newPeriodEnd = subscription.currentPeriodEnd ?? null
  }
  if (!newPeriodEnd) {
    logInvoice.warn({ invoiceId: invoice.id, subscriptionId }, 'invoice.paid — skipped period update because period end could not be resolved')
    return
  }

  const userId = subscription.userId
  const customerId = subscription.customerId ?? getStripeCustomerId(invoice.customer)
  const { rowsUpdated } = await applySubscriptionStateWithBackfill({
    subscriptionId,
    isPro: true,
    currentPeriodEnd: newPeriodEnd,
    cancelAtPeriodEnd: subscription.cancelAtPeriodEnd,
    subscriptionInterval: subscription.interval,
    userId,
    customerId,
    subscriptionStart: subscription.startDate,
  })
  if (rowsUpdated === 0) {
    if (!userId) {
      if (customerId) {
        throw new Error(
          `invoice.paid could not link subscription ${subscriptionId} to an app user (invoice ${invoice.id})`,
        )
      }
      logInvoice.error(
        {
          invoiceId: invoice.id,
          subscriptionId,
          customerId,
        },
        'invoice.paid skipped — no linkable app user for subscription',
      )
      return
    }
    throw new Error(
      `invoice.paid did not update local state for subscription ${subscriptionId} (invoice ${invoice.id})`,
    )
  }

  logInvoice.info(
    { subscriptionId, invoiceId: invoice.id, newPeriodEndsAt: newPeriodEnd.toISOString() },
    'invoice.paid — subscription renewed, next period updated',
  )
}

// ─── Subscription handlers ────────────────────────────────────────────────────

export async function handleSubscriptionDeleted(subscription: Stripe.Subscription) {
  const periodEnd = getPrimarySubscriptionItem(subscription)?.current_period_end
  const periodEndDate = periodEnd ? fromStripeTs(periodEnd) : undefined
  await clearStripeSubscriptionBySubId(subscription.id, periodEndDate)
  logSubscription.info(
    { subscriptionId: subscription.id, endsAt: periodEndDate?.toISOString() ?? 'immediately' },
    `customer.subscription.deleted — ${getStripeEventDescription('customer.subscription.deleted')}`,
  )
}

export async function handleSubscriptionTrialWillEnd(subscription: Stripe.Subscription) {
  await reconcileSubscriptionById(subscription.id)

  const customerId = getStripeCustomerId(subscription.customer)
  const dbUserId = customerId ? await getUserIdByStripeCustomerId(customerId) : null
  const dbUser = dbUserId ? await getUserById(dbUserId) : null
  let customerEmail = dbUser?.email
  if (!customerEmail && customerId) {
    const customer = await retrieveStripeCustomer(customerId)
    if (customer) customerEmail = customer.email ?? undefined
  }

  let emailSent = false
  if (customerId && customerEmail && subscription.status === 'trialing') {
    const result = await sendBillingPortalRecoveryEmail({
      sourceEvent: 'customer.subscription.trial_will_end',
      customerId,
      email: customerEmail,
      contextId: subscription.id,
      missingPortalUrlMessage: 'trial ending email could not be sent because portal session URL was missing',
      successMessage: 'trial ending reminder was sent',
      failureMessage: 'trial ending reminder could not be sent',
      sendEmail: ({ portalUrl, to }) => sendBillingTrialEndingEmail({
        subscriptionId: subscription.id,
        portalUrl,
        to,
      }),
    })
    emailSent = result.emailSent
  }

  logSubscription.info(
    {
      subscriptionId: subscription.id,
      status: subscription.status,
      trialEnd: subscription.trial_end ? fromStripeTs(subscription.trial_end).toISOString() : null,
      emailSent,
    },
    `customer.subscription.trial_will_end — ${getStripeEventDescription('customer.subscription.trial_will_end')}`,
  )
}

// ─── Customer handlers ────────────────────────────────────────────────────────

export async function handleCustomerDeleted(customer: Stripe.Customer | Stripe.DeletedCustomer) {
  const linkedUserId = await getUserIdByStripeCustomerId(customer.id)
  await clearStripeCustomerByCustomerId(customer.id)
  logCustomer.info({ customerId: customer.id, linkedUserId }, 'customer.deleted — local Stripe customer link cleared')
}

// ─── Billing recovery email (formerly stripe-billing-recovery-email.ts) ───────

export interface BillingRecoveryEmailSendArgs {
  portalUrl: string
  to: string
}

export interface BillingPortalRecoveryEmailParams {
  sourceEvent: string
  customerId: string | null
  email: string | null
  contextId: string
  sendEmail: (args: BillingRecoveryEmailSendArgs) => Promise<EmailSendResult>
  missingFieldsMessage?: string
  missingPortalUrlMessage?: string
  successMessage?: string
  failureMessage?: string
}

export interface BillingPortalRecoveryEmailResult {
  emailSent: boolean
}

/** Creates a billing portal session and sends a recovery email when customer contact info is present. */
export async function sendBillingPortalRecoveryEmail(
  params: BillingPortalRecoveryEmailParams,
): Promise<BillingPortalRecoveryEmailResult> {
  const {
    sourceEvent,
    customerId,
    email,
    contextId,
    missingFieldsMessage = 'billing recovery email could not be sent because customer ID or email was missing',
    missingPortalUrlMessage = 'billing recovery email could not be sent because portal session URL was missing',
    successMessage = 'billing recovery email was sent',
    failureMessage = 'billing recovery email could not be sent',
    sendEmail,
  } = params

  const dbUserId = customerId ? await getUserIdByStripeCustomerId(customerId) : null
  const dbUser = dbUserId ? await getUserById(dbUserId) : null
  const recipientEmail = dbUser?.email ?? email

  if (!customerId || !recipientEmail) {
    logRecovery.warn(
      { contextId, customerId, hasCustomerEmail: Boolean(recipientEmail) },
      `${sourceEvent} — ${missingFieldsMessage}`,
    )
    return { emailSent: false }
  }

  let portalSession: Awaited<ReturnType<typeof createPortalSession>>
  try {
    portalSession = await createPortalSession(customerId, `${getBaseUrl()}/settings`)
  } catch (error) {
    logRecovery.error({ contextId, customerId, err: error }, `${sourceEvent} — billing portal session creation failed`)
    throw new Error(
      `billing recovery portal session failed for ${contextId}`,
    )
  }
  if (!portalSession.url) {
    logRecovery.warn({ contextId, customerId }, `${sourceEvent} — ${missingPortalUrlMessage}`)
    return { emailSent: false }
  }

  const result = await sendEmail({ portalUrl: portalSession.url, to: recipientEmail })
  const emailSent = result === 'sent'
  const logContext = {
    contextId,
    customerId,
    email: recipientEmail,
    ...(recipientEmail !== email ? { originalStripeEmail: email } : {}),
    emailResult: result,
  }

  if (result === 'sent') {
    logRecovery.info(logContext, `${sourceEvent} — ${successMessage}`)
  } else if (result === 'skipped') {
    logRecovery.info(logContext, `${sourceEvent} — billing recovery email skipped (outbound email disabled)`)
  } else {
    logRecovery.warn(logContext, `${sourceEvent} — ${failureMessage}`)
  }

  return { emailSent }
}

// ─── Webhook dispatcher (formerly stripe-webhook-handlers.ts) ─────────────────

async function handleSubscriptionUpsert(
  subscription: Stripe.Subscription,
  sourceEvent: SubscriptionUpsertSourceEvent,
): Promise<void> {
  await upsertSubscriptionStateFromObject(subscription, sourceEvent)
}

export async function processStripeWebhookEvent(event: Stripe.Event): Promise<void> {
  const description = getStripeEventDescription(event.type)

  if (isSubscriptionUpsertEvent(event.type)) {
    await handleSubscriptionUpsert(
      event.data.object as Stripe.Subscription,
      event.type,
    )
    return
  }

  switch (event.type) {
    case 'checkout.session.completed':
      await handleCheckoutSessionCompleted(event.data.object as Stripe.Checkout.Session, false)
      return
    case 'checkout.session.async_payment_failed':
      await handleAbandonedCheckoutSession(event.data.object as Stripe.Checkout.Session, event.type, description)
      return
    case 'checkout.session.async_payment_succeeded':
      await handleCheckoutSessionCompleted(event.data.object as Stripe.Checkout.Session, true)
      return
    case 'checkout.session.expired':
      await handleAbandonedCheckoutSession(event.data.object as Stripe.Checkout.Session, event.type, description)
      return
    case 'customer.subscription.deleted':
      await handleSubscriptionDeleted(event.data.object as Stripe.Subscription)
      return
    case 'invoice.paid':
      await handleInvoicePaid(event.data.object as Stripe.Invoice)
      return
    case 'invoice.payment_failed':
    case 'invoice.payment_action_required':
    case 'invoice.payment_attempt_required':
      await handleInvoiceBillingRecovery(event.data.object as Stripe.Invoice, event.type)
      return
    case 'customer.subscription.trial_will_end':
      await handleSubscriptionTrialWillEnd(event.data.object as Stripe.Subscription)
      return
    case 'customer.deleted':
      await handleCustomerDeleted(event.data.object as Stripe.Customer | Stripe.DeletedCustomer)
      return
    case 'customer.updated': {
      const customer = event.data.object as Stripe.Customer
      logCustomer.info(
        {
          customerId: customer.id,
          email: customer.email,
          previousEmail: (event.data.previous_attributes as { email?: string } | undefined)?.email,
        },
        'customer.updated — Stripe customer email changed or customer updated',
      )
      return
    }
    case 'charge.refunded':
      await handleChargeRefunded(event.data.object as Stripe.Charge)
      return
    case 'charge.dispute.created':
      await handleChargeDisputeCreated(event.data.object as Stripe.Dispute)
      return
    case 'charge.dispute.closed':
      await handleChargeDisputeClosed(event.data.object as Stripe.Dispute)
      return
    default:
      logCustomer.warn(
        {
          eventId: event.id,
          eventType: event.type,
        },
        'Unhandled Stripe webhook event ignored',
      )
  }
}
