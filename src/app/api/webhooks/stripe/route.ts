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
import { createLogger } from '@/lib/infra/logger'

const log = createLogger('stripe-webhook-route')

// Stripe Dashboard webhook endpoint must subscribe to every event in
// REQUIRED_STRIPE_WEBHOOK_EVENTS (src/lib/billing/config/stripe-webhook-config.ts).

export const POST = apiRoute(async (req: NextRequest) => {
  const body = await req.text() // MUST BE RAW TEXT
  const signature = req.headers.get('stripe-signature')
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET

  if (!signature) {
    log.error('Webhook received with no stripe-signature header', { bodyLength: body.length })
    return ApiResponse.BAD_REQUEST('No signature found')
  }

  if (!webhookSecret) {
    log.error('STRIPE_WEBHOOK_SECRET is not configured', { bodyLength: body.length })
    return ApiResponse.INTERNAL_ERROR('Webhook secret not configured')
  }

  let event: Stripe.Event
  try {
    event = constructStripeWebhookEvent(body, signature, webhookSecret)
  } catch (err: unknown) {
    log.error('Webhook signature verification failed', { error: err })
    return ApiResponse.BAD_REQUEST('Invalid signature')
  }

  const claimed = await claimStripeWebhookEvent(event.id, event.type)
  if (!claimed) {
    log.info('Skipped duplicate Stripe webhook event', { eventId: event.id, eventType: event.type })
    return ApiResponse.OK({ received: true })
  }

  try {
    await processStripeWebhookEvent(event)
  } catch (error) {
    await releaseStripeWebhookEvent(event.id)
    log.error('Webhook handler failed — requesting Stripe retry', {
      eventId: event.id,
      eventType: event.type,
      error,
    })
    return ApiResponse.INTERNAL_ERROR('Webhook handler failed')
  }

  try {
    await markStripeWebhookEventProcessed(event.id, event.type)
  } catch (error) {
    await releaseStripeWebhookEvent(event.id)
    log.error(
      'WEBHOOK_PROCESSED_MARK_FAILED',
      {
        eventId: event.id,
        eventType: event.type,
        error,
      },
      'Handler succeeded but processed mark failed — released claim for Stripe retry',
    )
    return ApiResponse.INTERNAL_ERROR('Failed to mark webhook event as processed')
  }

  log.info('Webhook processed', { eventId: event.id, eventType: event.type })
  return ApiResponse.OK({ received: true })
})
