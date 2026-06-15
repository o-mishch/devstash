import { NextRequest } from 'next/server'
import type Stripe from 'stripe'
import { constructStripeWebhookEvent } from '@/lib/stripe'
import { processStripeWebhookEvent } from '@/lib/billing/webhook/stripe-webhook-event-handlers'
import {
  claimStripeWebhookEvent,
  markStripeWebhookEventProcessed,
  releaseStripeWebhookEvent,
} from '@/lib/billing/webhook/stripe-webhook-idempotency'
import { apiRoute, ApiResponse } from '@/lib/api'
import { logger } from '@/lib/infra/pino'

const log = logger.child({ tag: 'stripe-webhook-route' })

// Stripe Dashboard webhook endpoint must subscribe to every event in
// REQUIRED_STRIPE_WEBHOOK_EVENTS (src/lib/billing/config/stripe-webhook-config.ts).

export const POST = apiRoute(async (req: NextRequest) => {
  const body = await req.text() // MUST BE RAW TEXT
  const signature = req.headers.get('stripe-signature')
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET

  if (!signature) {
    log.error({ bodyLength: body.length }, 'Webhook received with no stripe-signature header')
    return ApiResponse.BAD_REQUEST('No signature found')
  }

  if (!webhookSecret) {
    log.error({ bodyLength: body.length }, 'STRIPE_WEBHOOK_SECRET is not configured')
    return ApiResponse.INTERNAL_ERROR('Webhook secret not configured')
  }

  let event: Stripe.Event
  try {
    event = constructStripeWebhookEvent(body, signature, webhookSecret)
  } catch (err: unknown) {
    log.error({ err }, 'Webhook signature verification failed')
    return ApiResponse.BAD_REQUEST('Invalid signature')
  }

  const claimed = await claimStripeWebhookEvent(event.id, event.type)
  if (!claimed) {
    log.info({ eventId: event.id, eventType: event.type }, 'Skipped duplicate Stripe webhook event')
    return ApiResponse.OK({ received: true })
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
    return ApiResponse.INTERNAL_ERROR('Webhook handler failed')
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
    return ApiResponse.INTERNAL_ERROR('Failed to mark webhook event as processed')
  }

  log.info({ eventId: event.id, eventType: event.type }, 'Webhook processed')
  return ApiResponse.OK({ received: true })
})
