import 'server-only'

import { getRedis, isAbortOrTimeout } from '@/lib/infra/redis'
import { logger } from '@/lib/infra/pino'

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
  const log = logger.child({ tag: logTag })
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
      { namespace, envVars: ['UPSTASH_REDIS_REST_URL', 'UPSTASH_REDIS_REST_TOKEN'] },
      'Upstash Redis is not configured in production — cache is disabled',
    )
  }

  async function read(key: string): Promise<T | null> {
    const redis = getRedis()
    if (redis) {
      try {
        const cached = await redis.get<T>(buildKey(key))
        if (cached !== null && cached !== undefined) {
          log.info({ key, redisKey: buildKey(key) }, 'Cache hit')
          return cached
        }
      } catch (error) {
        if (isAbortOrTimeout(error)) {
          log.warn({
            key,
            redisKey: buildKey(key),
            errorMessage: error instanceof Error ? error.message : String(error),
          }, 'Cache read timed out')
        } else {
          log.warn({ key, redisKey: buildKey(key), err: error }, 'Cache read failed')
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
        log.info({ key, redisKey: buildKey(key), ttlSeconds }, 'Cache write')
      } catch (error) {
        if (isAbortOrTimeout(error)) {
          log.warn({
            key,
            redisKey: buildKey(key),
            ttlSeconds,
            errorMessage: error instanceof Error ? error.message : String(error),
          }, 'Cache write timed out')
        } else {
          log.warn({ key, redisKey: buildKey(key), ttlSeconds, err: error }, 'Cache write failed')
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
        log.info({ key, redisKey: buildKey(key) }, 'Cache invalidated')
      } catch (error) {
        if (isAbortOrTimeout(error)) {
          log.warn({
            key,
            redisKey: buildKey(key),
            errorMessage: error instanceof Error ? error.message : String(error),
          }, 'Cache invalidation timed out')
        } else {
          log.warn({ key, redisKey: buildKey(key), err: error }, 'Cache invalidation failed')
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
