import { Redis } from '@upstash/redis'

let _client: Redis | null = null

export function getRedis(): Redis | null {
  if (_client) return _client
  try {
    // 5s timeout per call — generous enough for serverless cold-start DNS+TLS overhead
    // while still preventing hung connections. `cache: 'no-store'` opts out of Next.js's
    // fetch cache layer, which has no benefit for transient Redis commands.
    // `enableAutoPipelining` collapses commands issued in the same tick into one `/pipeline`
    // HTTP round-trip — so the four same-tick `getRemaining` reads in `getAiUsage` cost one
    // call. The enforcement limiters issue a single command per request, so this is a no-op for them.
    _client = Redis.fromEnv({
      signal: () => AbortSignal.timeout(5000),
      cache: 'no-store',
      enableAutoPipelining: true,
    })
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
