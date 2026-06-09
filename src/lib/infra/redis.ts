import { Redis } from '@upstash/redis'

let _client: Redis | null = null

export function getRedis(): Redis | null {
  if (_client) return _client
  try {
    _client = Redis.fromEnv()
    return _client
  } catch {
    return null
  }
}

// Namespace prefix used by @upstash/ratelimit — keys take the form `rl:<action>:<identifier>`
export const RATE_LIMIT_NS = 'rl'
