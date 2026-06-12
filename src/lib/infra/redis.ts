import { Redis } from '@upstash/redis'

let _client: Redis | null = null

export function getRedis(): Redis | null {
  if (_client) return _client
  try {
    // 5s timeout per call — generous enough for serverless cold-start DNS+TLS overhead
    // while still preventing hung connections. `cache: 'no-store'` opts out of Next.js's
    // fetch cache layer, which has no benefit for transient Redis commands.
    _client = Redis.fromEnv({ signal: () => AbortSignal.timeout(5000), cache: 'no-store' })
    return _client
  } catch {
    return null
  }
}

// Namespace prefix used by @upstash/ratelimit — keys take the form `rl:<action>:<identifier>`
export const RATE_LIMIT_NS = 'rl'

export function isAbortOrTimeout(error: unknown): boolean {
  return error instanceof Error && (error.name === 'AbortError' || error.name === 'TimeoutError')
}
