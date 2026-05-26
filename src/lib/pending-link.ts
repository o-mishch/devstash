import crypto from 'crypto'
import { getRedis } from '@/lib/redis'

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

const TTL_SECONDS = 60 * 15 // 15 minutes

export async function createPendingLink(data: PendingLinkData): Promise<string | null> {
  try {
    const redis = getRedis()
    if (!redis) return null
    const token = crypto.randomBytes(32).toString('hex')
    await redis.set(`pending-link:${token}`, JSON.stringify(data), { ex: TTL_SECONDS })
    return token
  } catch {
    return null
  }
}

export async function getPendingLink(token: string): Promise<PendingLinkData | null> {
  try {
    const redis = getRedis()
    if (!redis) return null
    const raw = await redis.get(`pending-link:${token}`)
    if (!raw) return null
    // Upstash auto-deserializes JSON in some client configurations; handle both cases
    return typeof raw === 'string' ? (JSON.parse(raw) as PendingLinkData) : (raw as PendingLinkData)
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
