import 'server-only'

import type { Redis } from '@upstash/redis'

let _client: Redis | null = null

/**
 * True on long-running deployments (GKE/Memorystore, local kind) where the app
 * talks native TCP via node-redis. False on Vercel, where the connectionless
 * @upstash/redis REST client is used. Gated solely by REDIS_URL — never set on
 * Vercel — so the serverless path is byte-for-byte unchanged.
 */
export function isTcpRedis(): boolean {
  return Boolean(process.env.REDIS_URL)
}

export function getRedis(): Redis | null {
  if (isTcpRedis()) {
    // Gated, synchronous require so node-redis (the native TCP backend in redis-tcp.ts)
    // is never resolved on the Vercel/Upstash path — only loaded when REDIS_URL is set.
    // Mirrors the @prisma/adapter-pg gate in db-local.ts. A sync require (not `await
    // import`) is required because getRedis() has synchronous callers.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { getTcpRedis } = require('./redis-tcp') as typeof import('@/lib/infra/redis-tcp')
    return getTcpRedis()
  }
  if (_client) return _client
  try {
    // Gated, synchronous require so @upstash/redis is never resolved on the self-hosted
    // (REDIS_URL) path — only loaded here, on the Vercel/Upstash default. This is what lets
    // next.config trace-exclude @upstash/redis from the self-hosted image. Mirrors the
    // node-redis require above.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { Redis } = require('@upstash/redis') as typeof import('@upstash/redis')
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

export function isAbortOrTimeout(error: unknown): boolean {
  return error instanceof Error && (error.name === 'AbortError' || error.name === 'TimeoutError')
}
