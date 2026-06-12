import 'server-only'

import { getRedis } from '@/lib/infra/redis'
import { createLogger } from '@/lib/infra/logger'

function isAbortOrTimeout(error: unknown): boolean {
  return error instanceof Error && (error.name === 'AbortError' || error.name === 'TimeoutError')
}

function shouldUseMemoryFallback(): boolean {
  return process.env.NODE_ENV !== 'production'
}

interface RedisCacheOptions {
  namespace: string
  defaultTtlSeconds: number
  logTag: string
  warnMissingRedisInProduction?: boolean
}

export function makeRedisCache<T>(options: RedisCacheOptions) {
  const { namespace, defaultTtlSeconds, logTag, warnMissingRedisInProduction = false } = options
  const log = createLogger(logTag)
  const memoryCache = new Map<string, { value: T; expiresAt: number }>()
  let loggedMissingRedis = false

  function buildKey(key: string): string {
    return `${namespace}:${key}`
  }

  function warnIfMissingInProd(): void {
    if (!warnMissingRedisInProduction) return
    if (process.env.NODE_ENV !== 'production' || getRedis() || loggedMissingRedis) return
    loggedMissingRedis = true
    log.warn(
      'Upstash Redis is not configured in production — cache is disabled',
      { namespace, envVars: ['UPSTASH_REDIS_REST_URL', 'UPSTASH_REDIS_REST_TOKEN'] },
    )
  }

  async function read(key: string): Promise<T | null> {
    const redis = getRedis()
    if (redis) {
      try {
        const cached = await redis.get<T>(buildKey(key))
        if (cached !== null && cached !== undefined) return cached
      } catch (error) {
        if (isAbortOrTimeout(error)) {
          log.warn('Cache read timed out', { key })
        } else {
          log.warn('Cache read failed', { key, error })
        }
      }
    } else {
      warnIfMissingInProd()
    }

    if (!shouldUseMemoryFallback()) return null

    const entry = memoryCache.get(key)
    if (!entry) return null
    if (Date.now() >= entry.expiresAt) {
      memoryCache.delete(key)
      return null
    }
    return entry.value
  }

  async function write(key: string, value: T, ttlSeconds = defaultTtlSeconds): Promise<void> {
    const redis = getRedis()
    if (redis) {
      try {
        await redis.set(buildKey(key), value, { ex: ttlSeconds })
      } catch (error) {
        if (isAbortOrTimeout(error)) {
          log.warn('Cache write timed out', { key })
        } else {
          log.warn('Cache write failed', { key, error })
        }
      }
    } else {
      warnIfMissingInProd()
    }

    if (!shouldUseMemoryFallback()) return

    memoryCache.set(key, {
      value,
      expiresAt: Date.now() + ttlSeconds * 1000,
    })
  }

  async function invalidate(key: string): Promise<void> {
    const redis = getRedis()
    if (redis) {
      try {
        await redis.del(buildKey(key))
      } catch (error) {
        if (isAbortOrTimeout(error)) {
          log.warn('Cache invalidation timed out', { key })
        } else {
          log.warn('Cache invalidation failed', { key, error })
        }
      }
    }
    memoryCache.delete(key)
  }

  async function invalidateMany(keys: Iterable<string>): Promise<void> {
    await Promise.all([...keys].map(invalidate))
  }

  return { read, write, invalidate, invalidateMany }
}
