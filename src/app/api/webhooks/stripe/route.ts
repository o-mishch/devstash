import type Stripe from 'stripe'
import { constructStripeWebhookEvent } from '@/lib/infra/stripe'
import { processStripeWebhookEvent } from '@/lib/billing/webhook/stripe-webhook-event-handlers'
import {
  claimStripeWebhookEvent,
  markStripeWebhookEventProcessed,
  releaseStripeWebhookEvent,
} from '@/lib/billing/webhook/stripe-webhook-idempotency'
import { publicRoute } from '@/lib/api/route'
import { json, problem } from '@/lib/api/http'
import { logger } from '@/lib/infra/pino'

const log = logger.child({ tag: 'stripe-webhook-route' })

// Stripe Dashboard webhook endpoint must subscribe to every event in
// REQUIRED_STRIPE_WEBHOOK_EVENTS (src/lib/billing/config/stripe-webhook-config.ts).

export const POST = publicRoute(async ({ request }) => {
  const body = await request.text() // MUST BE RAW TEXT
  const signature = request.headers.get('stripe-signature')
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET

  if (!signature) {
    log.error({ bodyLength: body.length }, 'Webhook received with no stripe-signature header')
    return problem(400, 'No signature found')
  }

  if (!webhookSecret) {
    log.error({ bodyLength: body.length }, 'STRIPE_WEBHOOK_SECRET is not configured')
    return problem(500, 'Webhook secret not configured')
  }

  let event: Stripe.Event
  try {
    event = constructStripeWebhookEvent(body, signature, webhookSecret)
  } catch (err: unknown) {
    log.error({ err }, 'Webhook signature verification failed')
    return problem(400, 'Invalid signature')
  }

  const claimed = await claimStripeWebhookEvent(event.id, event.type)
  if (!claimed) {
    log.info({ eventId: event.id, eventType: event.type }, 'Skipped duplicate Stripe webhook event')
    return json({ received: true })
  }

  try {
    await processStripeWebhookEvent(event)
  } catch (error) {
    await releaseStripeWebhookEvent(event.id)
    log.error({
      eventId: event.id,
      eventType: event.type,
      err: error,
    }, 'Webhook handler failed — requesting Stripe retry')
    return problem(500, 'Webhook handler failed')
  }

  try {
    await markStripeWebhookEventProcessed(event.id, event.type)
  } catch (error) {
    await releaseStripeWebhookEvent(event.id)
    log.error(
      {
        eventId: event.id,
        eventType: event.type,
        err: error,
      },
      'WEBHOOK_PROCESSED_MARK_FAILED — Handler succeeded but processed mark failed — released claim for Stripe retry',
    )
    return problem(500, 'Failed to mark webhook event as processed')
  }

  log.info({ eventId: event.id, eventType: event.type }, 'Webhook processed')
  return json({ received: true })
})

