import { z } from 'zod'
import type { ZodType } from 'zod'
import type {
  ZodOpenApiPathsObject,
  ZodOpenApiPathItemObject,
  ZodOpenApiResponseObject,
  ZodOpenApiResponsesObject,
} from 'zod-openapi'
import {
  stripeWebhookEnvelopeBase,
  stripeWebhookHeaders,
  webhookReceivedSchema,
  stripeCheckoutSessionPayload,
  stripeSubscriptionPayload,
  stripeInvoicePayload,
  stripeCustomerPayload,
  stripeChargePayload,
  stripeDisputePayload,
} from '../schemas/webhooks'
import { problemSchema } from '../schemas/common'
import {
  REQUIRED_STRIPE_WEBHOOK_EVENTS,
  getStripeEventDescription,
} from '@/lib/billing/config/stripe-webhook-config'

// OpenAPI 3.1 top-level `webhooks`: server-to-server callbacks our app RECEIVES, documented for
// visibility in /api-docs without entering the typed `api`/`$api` client contract (which only reads
// `paths`). Routes here stay exempt from the paths.ts contract — see api-contract.md.
//
// Every event Stripe POSTs hits the SAME endpoint (POST /api/webhooks/stripe). We emit one webhook
// entry per subscribed event type so Swagger lists them all individually, driven from the single
// source of truth (STRIPE_WEBHOOK_EVENT_CONFIG) so the docs can never drift from what we subscribe
// to. Each event's `data.object` is mapped to the curated payload schema for its object type. [C].

// event-type prefix → curated `data.object` payload schema. Mirrors the casts in the handler switch.
const payloadByPrefix: { prefix: string; payload: ZodType }[] = [
  { prefix: 'checkout.session.', payload: stripeCheckoutSessionPayload },
  { prefix: 'customer.subscription.', payload: stripeSubscriptionPayload },
  { prefix: 'invoice.', payload: stripeInvoicePayload },
  { prefix: 'charge.dispute.', payload: stripeDisputePayload },
  { prefix: 'charge.', payload: stripeChargePayload },
  { prefix: 'customer.', payload: stripeCustomerPayload },
]

function payloadForEvent(eventType: string): ZodType {
  const match = payloadByPrefix.find((entry) => eventType.startsWith(entry.prefix))
  if (!match) throw new Error(`No curated webhook payload mapped for Stripe event "${eventType}"`)
  return match.payload
}

const problem = (description: string): ZodOpenApiResponseObject => ({
  description,
  content: { 'application/json': { schema: problemSchema } },
})

const responses: ZodOpenApiResponsesObject = {
  200: {
    description: 'Event received (also returned for duplicate/already-processed events)',
    content: { 'application/json': { schema: webhookReceivedSchema } },
  },
  400: problem('Missing signature or signature verification failed'),
  500: problem('Webhook secret not configured or handler failed — Stripe will retry'),
}

export const webhooks: ZodOpenApiPathsObject = Object.fromEntries(
  REQUIRED_STRIPE_WEBHOOK_EVENTS.map((eventType): [string, ZodOpenApiPathItemObject] => [
    eventType,
    {
      post: {
        summary: `Stripe → POST /api/webhooks/stripe — ${eventType}`,
        description: getStripeEventDescription(eventType),
        requestParams: { header: stripeWebhookHeaders },
        requestBody: {
          content: {
            'application/json': {
              schema: stripeWebhookEnvelopeBase.extend({
                type: z.literal(eventType),
                data: z.object({ object: payloadForEvent(eventType) }),
              }),
            },
          },
        },
        responses,
      },
    },
  ]),
)
