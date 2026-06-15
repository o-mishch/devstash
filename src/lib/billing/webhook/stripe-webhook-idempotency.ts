import 'server-only'

import { logger } from '@/lib/infra/pino'
import { getRedis, isAbortOrTimeout } from '@/lib/infra/redis'
import {
  claimStripeWebhookEventInDb,
  markStripeWebhookEventProcessedInDb,
  pruneOldStripeWebhookEvents,
  releaseStaleStripeWebhookEvents,
  releaseStripeWebhookEventInDb,
  STALE_WEBHOOK_PROCESSING_MS,
} from '@/lib/db/stripe-webhook-events'

const log = logger.child({ tag: 'stripe-webhook-idempotency' })

const WEBHOOK_EVENT_TTL_SECONDS = 60 * 60 * 24 * 30
const WEBHOOK_EVENT_NS = 'stripe:webhook:event'
const DB_MAINTENANCE_INTERVAL_MS = 60_000

let lastDbMaintenanceAt = 0

function maybeRunDbMaintenance(): void {
  const now = Date.now()
  if (now - lastDbMaintenanceAt < DB_MAINTENANCE_INTERVAL_MS) return
  lastDbMaintenanceAt = now
  void pruneOldStripeWebhookEvents()
  void releaseStaleStripeWebhookEvents()
}

interface RedisWebhookEventMarker {
  type: string
  status: 'processing' | 'processed'
  claimedAt?: string
  processedAt?: string
}

function getWebhookEventKey(eventId: string): string {
  return `${WEBHOOK_EVENT_NS}:${eventId}`
}

function isStaleRedisWebhookClaim(marker: RedisWebhookEventMarker, now = Date.now()): boolean {
  if (marker.status !== 'processing') return false
  if (!marker.claimedAt) return true
  const claimedAtMs = Date.parse(marker.claimedAt)
  if (!Number.isFinite(claimedAtMs)) return true
  return now - claimedAtMs >= STALE_WEBHOOK_PROCESSING_MS
}

async function claimWithRedisOnce(
  redis: NonNullable<ReturnType<typeof getRedis>>,
  eventId: string,
  eventType: string,
  allowStaleReclaim: boolean,
): Promise<boolean> {
  const key = getWebhookEventKey(eventId)
  const result = await redis.set(
    key,
    {
      type: eventType,
      status: 'processing',
      claimedAt: new Date().toISOString(),
    },
    { nx: true, ex: WEBHOOK_EVENT_TTL_SECONDS },
  )

  if (result === 'OK') return true

  const existing = await redis.get<RedisWebhookEventMarker>(key)
  if (!existing) return false
  if (existing.status === 'processed') return false

  if (allowStaleReclaim && isStaleRedisWebhookClaim(existing)) {
    await redis.del(key)
    return claimWithRedisOnce(redis, eventId, eventType, false)
  }

  return false
}

async function claimWithRedis(eventId: string, eventType: string): Promise<boolean | null> {
  const redis = getRedis()
  if (!redis) return null

  try {
    return await claimWithRedisOnce(redis, eventId, eventType, true)
  } catch (error) {
    if (isAbortOrTimeout(error)) {
      log.warn({ eventId, err: error }, 'Redis webhook claim timed out — falling back to DB idempotency')
    } else {
      log.warn({ eventId, err: error }, 'Redis webhook claim failed — falling back to DB idempotency')
    }
    return null
  }
}

export async function claimStripeWebhookEvent(eventId: string, eventType: string): Promise<boolean> {
  maybeRunDbMaintenance()
  let dbClaimed: boolean
  try {
    dbClaimed = await claimStripeWebhookEventInDb(eventId, eventType)
  } catch (error) {
    log.error({ eventId, err: error }, 'DB webhook claim failed')
    throw new Error(`Failed to claim webhook event ${eventId} after stale reclaim retries`)
  }
  if (!dbClaimed) return false

  // Best-effort Redis marker for fast duplicate detection — DB claim is authoritative.
  await claimWithRedis(eventId, eventType)

  return true
}

export async function markStripeWebhookEventProcessed(eventId: string, eventType: string): Promise<void> {
  try {
    const redis = getRedis()
    if (redis) {
      await redis.set(
        getWebhookEventKey(eventId),
        {
          type: eventType,
          status: 'processed',
          processedAt: new Date().toISOString(),
        },
        { ex: WEBHOOK_EVENT_TTL_SECONDS }
      )
    }
  } catch (error) {
    // Redis marker is optional — DB is authoritative. Log so we notice persistent Redis issues.
    log.warn({ eventId, eventType, err: error }, 'Redis webhook processed marker failed')
  }

  try {
    await markStripeWebhookEventProcessedInDb(eventId)
  } catch (error) {
    log.error({ eventId, err: error }, 'Failed to mark webhook event processed in database — retrying')
    for (let attempt = 1; attempt <= 2; attempt += 1) {
      try {
        await markStripeWebhookEventProcessedInDb(eventId)
        return
      } catch (retryError) {
        log.error({ eventId, attempt, err: retryError }, 'Webhook processed mark retry failed')
      }
    }
    throw new Error(`Failed to mark webhook event ${eventId} as processed`)
  }
}

export async function releaseStripeWebhookEvent(eventId: string): Promise<void> {
  try {
    const redis = getRedis()
    if (redis) await redis.del(getWebhookEventKey(eventId))
  } catch (error) {
    // Non-fatal — event expires via TTL. Log so persistent Redis issues are visible.
    log.warn({ eventId, err: error }, 'Redis webhook event release failed')
  }

  try {
    await releaseStripeWebhookEventInDb(eventId)
  } catch {
    // Fail open — event will expire automatically if delete fails.
  }
}
