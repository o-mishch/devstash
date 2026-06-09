import { getRedis } from '@/lib/infra/redis'
import { generateSecureToken } from '@/lib/auth/tokens'


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
  try {
    const redis = getRedis()
    if (!redis) return null
    const token = generateSecureToken()
    const key = `pending-link:${token}`
    const ttl = 60 * 15 // 15 minutes
    await redis.set(key, data, { ex: ttl })
    return token
  } catch {
    return null
  }
}

export async function getPendingLink(token: string): Promise<PendingLinkData | null> {
  try {
    const redis = getRedis()
    if (!redis) return null
    return await redis.get<PendingLinkData>(`pending-link:${token}`)
  } catch {
    return null
  }
}

export async function deletePendingLink(token: string): Promise<void> {
  try {
    const redis = getRedis()
    if (!redis) return
    await redis.del(`pending-link:${token}`)
  } catch {
    // fail open — non-critical, token expires automatically via TTL
  }
}

export async function createLinkIntent(userId: string): Promise<string | null> {
  try {
    const redis = getRedis()
    if (!redis) return null
    const token = generateSecureToken()
    await redis.set(`link-intent:${token}`, { userId } as LinkIntentData, { ex: 60 * 5 })
    return token
  } catch {
    return null
  }
}

export async function getLinkIntent(token: string): Promise<LinkIntentData | null> {
  try {
    const redis = getRedis()
    if (!redis) return null
    return await redis.get<LinkIntentData>(`link-intent:${token}`)
  } catch {
    return null
  }
}

export async function deleteLinkIntent(token: string): Promise<void> {
  try {
    const redis = getRedis()
    if (!redis) return
    await redis.del(`link-intent:${token}`)
  } catch {
    // fail open
  }
}
