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

export interface CacheEntry {
  key: string
  ttl: number
}

const CacheTTL = {
  items:       60,
  collections: 60,
  profile:     300,
  itemTypes:   3600,
  pendingLink: 60 * 15,
} as const

export const CacheKeys = {
  pinnedItems:    (userId: string)               => ({ key: `user:${userId}:pinned-items`,     ttl: CacheTTL.items }),
  recentItems:    (userId: string)               => ({ key: `user:${userId}:recent-items`,      ttl: CacheTTL.items }),
  itemsByType:    (userId: string, type: string) => ({ key: `user:${userId}:items:${type}`,     ttl: CacheTTL.items }),
  itemStats:      (userId: string)               => ({ key: `user:${userId}:item-stats`,         ttl: CacheTTL.items }),
  sidebarTypes:   (userId: string)               => ({ key: `user:${userId}:sidebar-types`,     ttl: CacheTTL.items }),
  allCollections: (userId: string)               => ({ key: `user:${userId}:collections`,        ttl: CacheTTL.collections }),
  collectionStats:(userId: string)               => ({ key: `user:${userId}:collection-stats`,  ttl: CacheTTL.collections }),
  profile:        (userId: string)               => ({ key: `user:${userId}:profile`,            ttl: CacheTTL.profile }),
  itemTypeBySlug: (slug: string)                 => ({ key: `item-type:slug:${slug}`,            ttl: CacheTTL.itemTypes }),
  pendingLink:    (token: string)                => ({ key: `pending-link:${token}`,             ttl: CacheTTL.pendingLink }),
} as const

// Namespace prefix used by @upstash/ratelimit — keys take the form `rl:<action>:<identifier>`
export const RATE_LIMIT_NS = 'rl'

export async function withCache<T>(
  entry: CacheEntry,
  fetcher: () => Promise<T>
): Promise<T> {
  const redis = getRedis()

  if (redis) {
    try {
      const cached = await redis.get<T>(entry.key)
      if (cached !== null) return cached
    } catch {
      // fail open — Redis unavailable, fall through to DB
    }
  }

  const data = await fetcher()

  if (redis) {
    try {
      await redis.set(entry.key, data, { ex: entry.ttl })
    } catch {
      // fail open — data still returned even if cache write fails
    }
  }

  return data
}

export async function invalidateCache(...entries: CacheEntry[]): Promise<void> {
  if (!entries.length) return
  const redis = getRedis()
  if (!redis) return
  try {
    await redis.del(...entries.map((e) => e.key))
  } catch {
    // fail open
  }
}
