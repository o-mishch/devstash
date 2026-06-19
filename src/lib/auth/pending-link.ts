import 'server-only'

import { getRedis } from '@/lib/infra/redis'
import { generateSecureToken } from '@/lib/auth/tokens'
import { logger } from '@/lib/infra/pino'

const log = logger.child({ tag: 'pending-link' })

async function redisOp<T>(logMsg: string, fn: (redis: NonNullable<ReturnType<typeof getRedis>>) => Promise<T>): Promise<T | null> {
  try {
    const redis = getRedis()
    if (!redis) return null
    return await fn(redis)
  } catch (error) {
    log.warn({ err: error }, logMsg)
    return null
  }
}

export interface PendingLinkData {
  email: string           // DevStash user's primary email (for session verification)
  providerEmail: string | null  // OAuth provider email (stored on Account.email)
  provider: string
  providerAccountId: string
  type: string
  access_token: string | null
  refresh_token: string | null
  expires_at: number | null
  token_type: string | null
  scope: string | null
  id_token: string | null
  session_state: string | null
}

export interface LinkIntentData {
  userId: string
}

export async function createPendingLink(data: PendingLinkData): Promise<string | null> {
  const token = generateSecureToken()
  const stored = await redisOp('Failed to create pending link in Redis', (r) =>
    r.set(`pending-link:${token}`, data, { ex: 60 * 15 })
  )
  return stored !== null ? token : null
}

export async function getPendingLink(token: string): Promise<PendingLinkData | null> {
  return redisOp('Failed to read pending link from Redis', (r) =>
    r.get<PendingLinkData>(`pending-link:${token}`)
  )
}

// Fail open: distinguishes expired (key absent → null) from Redis error (caught here → null).
// A Redis outage returns null, which surfaces as "link expired" to the user — acceptable given
// the 15-minute TTL; the token is still alive in Redis and will work once the service recovers.
export async function consumePendingLink(token: string): Promise<PendingLinkData | null> {
  return redisOp('Failed to consume pending link from Redis', (r) =>
    r.getdel<PendingLinkData>(`pending-link:${token}`)
  )
}

export async function createLinkIntent(userId: string): Promise<string | null> {
  const token = generateSecureToken()
  const stored = await redisOp('Failed to create link intent in Redis', (r) =>
    r.set(`link-intent:${token}`, { userId } as LinkIntentData, { ex: 60 * 5 })
  )
  return stored !== null ? token : null
}

export async function getLinkIntent(token: string): Promise<LinkIntentData | null> {
  return redisOp('Failed to read link intent from Redis', (r) =>
    r.get<LinkIntentData>(`link-intent:${token}`)
  )
}

export async function consumeLinkIntent(token: string): Promise<LinkIntentData | null> {
  return redisOp('Failed to consume link intent from Redis', (r) =>
    r.getdel<LinkIntentData>(`link-intent:${token}`)
  )
}

