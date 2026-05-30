import { getRedis } from '@/lib/redis'
import { generateSecureToken } from '@/lib/tokens'


export interface PendingLinkData {
  email: string
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
