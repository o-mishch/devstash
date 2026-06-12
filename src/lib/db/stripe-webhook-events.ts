import 'server-only'

import { Prisma } from '@/generated/prisma'
import { prisma } from '@/lib/infra/prisma'
import { createLogger } from '@/lib/infra/logger'

const log = createLogger('stripe-webhook-events')

const WEBHOOK_EVENT_RETENTION_MS = 30 * 24 * 60 * 60 * 1000
/** Processing claims older than this are treated as stale so Stripe retries can reclaim them. */
export const STALE_WEBHOOK_PROCESSING_MS = 15 * 60 * 1000
const MAX_STALE_CLAIM_RETRIES = 3

function isStaleWebhookProcessing(createdAt: Date, now = Date.now()): boolean {
  return now - createdAt.getTime() >= STALE_WEBHOOK_PROCESSING_MS
}

export async function releaseStaleStripeWebhookEvents(now = Date.now()): Promise<number> {
  const cutoff = new Date(now - STALE_WEBHOOK_PROCESSING_MS)
  const result = await prisma.stripeWebhookEvent.deleteMany({
    where: {
      status: 'processing',
      createdAt: { lt: cutoff },
    },
  })
  if (result.count > 0) {
    log.info('DB: stale_webhook_claims_released', { count: result.count })
  }
  return result.count
}

export async function claimStripeWebhookEventInDb(eventId: string, eventType: string): Promise<boolean> {
  for (let attempt = 0; attempt < MAX_STALE_CLAIM_RETRIES; attempt++) {
    try {
      await prisma.stripeWebhookEvent.create({
        data: {
          id: eventId,
          eventType,
          status: 'processing',
        },
      })
      return true
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        const existing = await prisma.stripeWebhookEvent.findUnique({
          where: { id: eventId },
          select: { status: true, createdAt: true },
        })
        if (existing?.status === 'processing' && isStaleWebhookProcessing(existing.createdAt, Date.now())) {
          log.warn('DB: Reclaiming stale webhook processing claim', { eventId, attempt: attempt + 1 })
          await prisma.stripeWebhookEvent.delete({ where: { id: eventId } })
          continue
        }
        return false
      }
      throw error
    }
  }

  throw new Error(`Failed to claim webhook event ${eventId} after stale reclaim retries`)
}

export async function markStripeWebhookEventProcessedInDb(eventId: string): Promise<void> {
  const result = await prisma.stripeWebhookEvent.updateMany({
    where: { id: eventId },
    data: {
      status: 'processed',
      processedAt: new Date(),
    },
  })
  if (result.count === 0) {
    throw new Error(`Webhook event ${eventId} was not found when marking processed`)
  }
}

export async function releaseStripeWebhookEventInDb(eventId: string): Promise<void> {
  await prisma.stripeWebhookEvent.deleteMany({
    where: { id: eventId },
  })
}

export async function pruneOldStripeWebhookEvents(now = Date.now()): Promise<void> {
  const cutoff = new Date(now - WEBHOOK_EVENT_RETENTION_MS)
  const result = await prisma.stripeWebhookEvent.deleteMany({
    where: {
      createdAt: { lt: cutoff },
    },
  })
  if (result.count > 0) {
    log.info('DB: old_webhook_events_pruned', { count: result.count })
  }
}
