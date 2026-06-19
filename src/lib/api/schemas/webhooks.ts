import { z } from 'zod'

// Schemas for inbound third-party webhooks. These are NOT part of the typed client contract — the
// browser never calls them — so they live in the OpenAPI document's top-level `webhooks` section
// (see openapi/webhooks.ts), not in `paths`. They exist only to document the server-to-server
// surface in /api-docs. [C].
//
// Payloads are CURATED, not exhaustive: each Stripe object carries the key fields our handlers act on
// (plus a docs link), and is `looseObject` so the OpenAPI doc advertises `additionalProperties: true`
// — honestly signalling "the real object has more fields; see Stripe's reference". Full per-object
// schemas would mean vendoring ~600 of Stripe's interlinked schemas; not worth the bloat.

const docs = (path: string): string => `See the full object: https://docs.stripe.com/api/${path}`

// checkout.session.* — https://docs.stripe.com/api/checkout/sessions/object
export const stripeCheckoutSessionPayload = z
  .looseObject({
    id: z.string(),
    object: z.literal('checkout.session'),
    mode: z.enum(['payment', 'setup', 'subscription']),
    status: z.enum(['open', 'complete', 'expired']).nullable(),
    payment_status: z.enum(['paid', 'unpaid', 'no_payment_required']),
    customer: z.string().nullable().describe('Customer ID (expandable; an ID string on the webhook).'),
    customer_email: z.string().nullable(),
    subscription: z.string().nullable().describe('Subscription ID, if mode=subscription.'),
    client_reference_id: z.string().nullable(),
    amount_total: z.number().nullable().describe('Total of the session in the smallest currency unit.'),
    currency: z.string().nullable(),
    metadata: z.record(z.string(), z.string()),
  })
  .meta({ id: 'StripeCheckoutSessionPayload', description: docs('checkout/sessions/object') })

// customer.subscription.* — https://docs.stripe.com/api/subscriptions/object
export const stripeSubscriptionPayload = z
  .looseObject({
    id: z.string(),
    object: z.literal('subscription'),
    status: z.enum([
      'trialing',
      'active',
      'past_due',
      'canceled',
      'unpaid',
      'incomplete',
      'incomplete_expired',
      'paused',
    ]),
    customer: z.string().describe('Customer ID (expandable; an ID string on the webhook).'),
    cancel_at_period_end: z.boolean(),
    current_period_end: z.number().nullable().describe('Unix timestamp the current period ends.'),
    canceled_at: z.number().nullable(),
    trial_end: z.number().nullable(),
    items: z.object({
      data: z.array(
        z.object({
          id: z.string(),
          price: z.object({ id: z.string(), product: z.string() }),
        }),
      ),
    }),
    metadata: z.record(z.string(), z.string()),
  })
  .meta({ id: 'StripeSubscriptionPayload', description: docs('subscriptions/object') })

// invoice.* — https://docs.stripe.com/api/invoices/object
export const stripeInvoicePayload = z
  .looseObject({
    id: z.string(),
    object: z.literal('invoice'),
    status: z.enum(['draft', 'open', 'paid', 'uncollectible', 'void']).nullable(),
    customer: z.string().describe('Customer ID (expandable; an ID string on the webhook).'),
    subscription: z.string().nullable(),
    amount_due: z.number(),
    amount_paid: z.number(),
    currency: z.string(),
    billing_reason: z.string().nullable().describe('e.g. subscription_create, subscription_cycle.'),
    attempt_count: z.number(),
    next_payment_attempt: z.number().nullable(),
    hosted_invoice_url: z.string().nullable(),
  })
  .meta({ id: 'StripeInvoicePayload', description: docs('invoices/object') })

// customer.updated / customer.deleted — https://docs.stripe.com/api/customers/object
export const stripeCustomerPayload = z
  .looseObject({
    id: z.string(),
    object: z.literal('customer'),
    email: z.string().nullable(),
    name: z.string().nullable(),
    created: z.number(),
    deleted: z.boolean().optional().describe('Present (true) on customer.deleted events.'),
    metadata: z.record(z.string(), z.string()),
  })
  .meta({ id: 'StripeCustomerPayload', description: docs('customers/object') })

// charge.refunded — https://docs.stripe.com/api/charges/object
export const stripeChargePayload = z
  .looseObject({
    id: z.string(),
    object: z.literal('charge'),
    amount: z.number(),
    amount_refunded: z.number(),
    currency: z.string(),
    customer: z.string().nullable().describe('Customer ID (expandable; an ID string on the webhook).'),
    payment_intent: z.string().nullable(),
    refunded: z.boolean(),
    status: z.enum(['succeeded', 'pending', 'failed']),
    receipt_url: z.string().nullable(),
  })
  .meta({ id: 'StripeChargePayload', description: docs('charges/object') })

// charge.dispute.* — https://docs.stripe.com/api/disputes/object
export const stripeDisputePayload = z
  .looseObject({
    id: z.string(),
    object: z.literal('dispute'),
    amount: z.number().describe('Disputed amount in the smallest currency unit.'),
    currency: z.string(),
    charge: z.string().describe('Charge ID (expandable; an ID string on the webhook).'),
    payment_intent: z.string().nullable(),
    reason: z.string().describe('e.g. fraudulent, product_not_received.'),
    status: z.string(),
  })
  .meta({ id: 'StripeDisputePayload', description: docs('disputes/object') })

// Both the 200 (processed) and the 200-on-duplicate responses return this body.
export const webhookReceivedSchema = z.object({ received: z.boolean() }).meta({ id: 'WebhookReceived' })

// Stripe signs the raw body; the header is verified before the event is trusted.
export const stripeWebhookHeaders = z.object({
  'stripe-signature': z.string(),
})

// Common Stripe.Event envelope, minus `type` (a literal per event) and `data.object` (a curated
// payload per event) — both supplied in openapi/webhooks.ts.
export const stripeWebhookEnvelopeBase = z.object({
  id: z.string(),
  object: z.literal('event'),
  api_version: z.string().nullable(),
  created: z.number(),
  livemode: z.boolean(),
})
