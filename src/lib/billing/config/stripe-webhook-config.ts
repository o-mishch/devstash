import 'server-only'

import type Stripe from 'stripe'

/**
 * Required Stripe webhook events and their human-readable descriptions for logging.
 * Stripe Dashboard endpoint must subscribe to every `type` listed here.
 */
const STRIPE_WEBHOOK_EVENT_CONFIG = [
  {
    type: 'checkout.session.completed',
    description: 'Occurs when a Checkout Session has been successfully completed.',
  },
  {
    type: 'checkout.session.async_payment_succeeded',
    description: 'Occurs when a payment intent using a delayed payment method finally succeeds.',
  },
  {
    type: 'checkout.session.async_payment_failed',
    description: 'Occurs when a payment intent using a delayed payment method fails.',
  },
  {
    type: 'checkout.session.expired',
    description: 'Occurs when a Checkout Session is expired.',
  },
  {
    type: 'customer.subscription.created',
    description: 'Occurs whenever a customer is signed up for a new plan.',
  },
  {
    type: 'customer.subscription.updated',
    description: 'Occurs whenever a subscription changes (e.g., switching from one plan to another, or changing the status from trial to active).',
  },
  {
    type: 'customer.subscription.deleted',
    description: "Occurs whenever a customer's subscription ends.",
  },
  {
    type: 'customer.subscription.paused',
    description: "Occurs whenever a customer's subscription is paused. Only applies when subscriptions enter status=paused, not when payment collection is paused.",
  },
  {
    type: 'customer.subscription.resumed',
    description: "Occurs whenever a customer's subscription is no longer paused. Only applies when a status=paused subscription is resumed, not when payment collection is resumed.",
  },
  {
    type: 'customer.subscription.pending_update_applied',
    description: "Occurs whenever a customer's subscription's pending update is applied, and the subscription is updated.",
  },
  {
    type: 'customer.subscription.pending_update_expired',
    description: "Occurs whenever a customer's subscription's pending update expires before the related invoice is paid.",
  },
  {
    type: 'customer.subscription.trial_will_end',
    description: "Occurs three days before a subscription's trial period is scheduled to end, or immediately when a trial is ended early (for example, with trial_end=now or when a Customer Portal plan change ends a trial). If a trial is shortened so that fewer than three days remain, this event can fire immediately, including during the same transaction that collects payment. Before sending payment-reminder communications from this webhook, check the subscription status and latest invoice to determine whether payment has already been collected.",
  },
  {
    type: 'invoice.paid',
    description: 'Occurs whenever an invoice payment attempt succeeds or an invoice is marked paid.',
  },
  {
    type: 'invoice.payment_failed',
    description: 'Occurs whenever an invoice payment attempt fails, due to either a declined payment, including soft decline, or to the lack of a stored payment method.',
  },
  {
    type: 'invoice.payment_action_required',
    description: 'Occurs whenever an invoice payment attempt requires further user action to complete.',
  },
  {
    type: 'invoice.payment_attempt_required',
    description: 'Occurs when an invoice requires a payment using a payment method that cannot be processed by Stripe.',
  },
  {
    type: 'charge.refunded',
    description: 'Occurs whenever a charge is refunded, including partial refunds.',
  },
  {
    type: 'charge.dispute.created',
    description: 'Occurs whenever a customer disputes a charge with their bank.',
  },
  {
    type: 'charge.dispute.closed',
    description: 'Occurs when a dispute is resolved or closed.',
  },
  {
    type: 'customer.updated',
    description: 'Occurs whenever any property of a customer changes, such as their email address.',
  },
  {
    type: 'customer.deleted',
    description: 'Occurs whenever a customer is deleted from Stripe.',
  },
] as const satisfies readonly { type: Stripe.Event.Type; description: string }[]

export type RequiredStripeWebhookEvent = (typeof STRIPE_WEBHOOK_EVENT_CONFIG)[number]['type']

export const REQUIRED_STRIPE_WEBHOOK_EVENTS: readonly RequiredStripeWebhookEvent[] =
  STRIPE_WEBHOOK_EVENT_CONFIG.map((entry) => entry.type)

const STRIPE_EVENT_DESCRIPTIONS = new Map<Stripe.Event['type'], string>(
  STRIPE_WEBHOOK_EVENT_CONFIG.map((entry) => [entry.type, entry.description]),
)

export function getStripeEventDescription(eventType: Stripe.Event['type']): string {
  return STRIPE_EVENT_DESCRIPTIONS.get(eventType) ?? eventType
}

export interface StripeWebhookEndpointSummary {
  id: string
  url: string
  enabled_events: string[]
}

export interface StripeWebhookEndpointValidation {
  id: string
  url: string
  missingEvents: Stripe.Event.Type[]
}

export interface StripeWebhookValidationResult {
  ok: boolean
  endpoints: StripeWebhookEndpointValidation[]
  message: string
}

function endpointCoversRequiredEvents(enabledEvents: string[]): Stripe.Event.Type[] {
  if (enabledEvents.includes('*') || enabledEvents.includes('/*')) return []
  const enabled = new Set(enabledEvents)
  return REQUIRED_STRIPE_WEBHOOK_EVENTS.filter((eventType) => !enabled.has(eventType))
}

export function validateStripeWebhookEndpoints(
  endpoints: StripeWebhookEndpointSummary[],
  webhookPath = '/api/webhooks/stripe',
): StripeWebhookValidationResult {
  const appEndpoints = endpoints.filter((endpoint) => endpoint.url.includes(webhookPath))

  if (appEndpoints.length === 0) {
    return {
      ok: false,
      endpoints: [],
      message: `No Stripe webhook endpoint URL contains "${webhookPath}".`,
    }
  }

  const validations = appEndpoints.map((endpoint) => ({
    id: endpoint.id,
    url: endpoint.url,
    missingEvents: endpointCoversRequiredEvents(endpoint.enabled_events),
  }))

  const ok = validations.every((endpoint) => endpoint.missingEvents.length === 0)
  const missingSummary = validations
    .filter((endpoint) => endpoint.missingEvents.length > 0)
    .map((endpoint) => `${endpoint.url}: ${endpoint.missingEvents.join(', ')}`)
    .join('; ')

  return {
    ok,
    endpoints: validations,
    message: ok
      ? `All ${appEndpoints.length} webhook endpoint(s) subscribe to required events.`
      : `Missing required webhook events — ${missingSummary}`,
  }
}
