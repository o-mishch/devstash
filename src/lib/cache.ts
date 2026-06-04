import { unstable_cache, revalidatePath, revalidateTag as _revalidateTag } from 'next/cache'
import { cache } from 'react'
import { createLogger } from '@/lib/logger'

const log = createLogger('cache')

// In some Next.js 15 canary versions, revalidateTag strictly requires a second `profile` argument
// for the new cacheLife API, even though at runtime 1 argument is valid. We cast it to avoid TS errors.
const revalidateTag = _revalidateTag as unknown as (tag: string) => void

export interface DataCacheConfig {
  tag: string
  revalidate: number
  tags?: string[]
}

const CacheRevalidate = {
  items: 60,
  collections: 60,
  profile: 300,
  itemTypes: 3600,
} as const

export const CacheTags = {
  pinnedItems: (userId: string) => ({ tag: `user:${userId}:pinned-items`, revalidate: CacheRevalidate.items, tags: [`items-${userId}`] }),
  favoriteItems: (userId: string) => ({ tag: `user:${userId}:favorite-items`, revalidate: CacheRevalidate.items, tags: [`items-${userId}`] }),
  favoriteItemTypeCounts: (userId: string) => ({ tag: `user:${userId}:favorite-item-type-counts`, revalidate: CacheRevalidate.items, tags: [`items-${userId}`] }),
  recentItems: (userId: string) => ({ tag: `user:${userId}:recent-items`, revalidate: CacheRevalidate.items, tags: [`items-${userId}`] }),
  itemsByType: (userId: string, type: string) => ({ tag: `user:${userId}:items:${type}`, revalidate: CacheRevalidate.items, tags: [`items-${userId}`] }),
  itemStats: (userId: string) => ({ tag: `user:${userId}:item-stats`, revalidate: CacheRevalidate.items, tags: [`items-${userId}`] }),
  sidebarTypes: (userId: string) => ({ tag: `user:${userId}:sidebar-types`, revalidate: CacheRevalidate.items, tags: [`items-${userId}`] }),
  allCollections: (userId: string) => ({ tag: `user:${userId}:collections`, revalidate: CacheRevalidate.collections, tags: [`collections-${userId}`] }),
  favoriteCollections: (userId: string) => ({ tag: `user:${userId}:favorite-collections`, revalidate: CacheRevalidate.collections, tags: [`collections-${userId}`] }),
  collectionById: (userId: string, collectionId: string) => ({ tag: `user:${userId}:collection:${collectionId}`, revalidate: CacheRevalidate.collections, tags: [`collections-${userId}`] }),
  itemById: (userId: string, itemId: string) => ({ tag: `user:${userId}:item:${itemId}`, revalidate: CacheRevalidate.items, tags: [`items-${userId}`] }),
  itemsByCollection: (userId: string, collectionId: string) => ({ tag: `user:${userId}:collection:${collectionId}:items`, revalidate: CacheRevalidate.items, tags: [`items-${userId}`] }),
  collectionStats: (userId: string) => ({ tag: `user:${userId}:collection-stats`, revalidate: CacheRevalidate.collections, tags: [`collections-${userId}`] }),
  profile: (userId: string) => ({ tag: `user:${userId}:profile`, revalidate: CacheRevalidate.profile }),
  itemTypeBySlug: (slug: string) => ({ tag: `item-type:slug:${slug}`, revalidate: CacheRevalidate.itemTypes }),
  systemItemTypes: () => ({ tag: `system-item-types`, revalidate: CacheRevalidate.itemTypes }),
} as const

// React.cache is scoped per-request. We use it to create a per-request Map
// which allows us to deduplicate unstable_cache calls across different components
// in the same render pass, using the string config.tag as the key.
const getRequestCache = cache(() => new Map<string, Promise<any>>())

export async function withDataCache<T>(
  config: DataCacheConfig,
  fetcher: () => Promise<T>
): Promise<T> {
  const requestCache = getRequestCache()

  if (requestCache.has(config.tag)) {
    return requestCache.get(config.tag)!
  }

  const promise = unstable_cache(
    async () => {
      log.info(`MISS ${config.tag}`)
      const start = Date.now()
      const result = await fetcher()
      log.info(`FETCHED ${config.tag} in ${Date.now() - start}ms`)
      // Strip Prisma proxies and non-serializable objects to guarantee successful caching
      return JSON.parse(JSON.stringify(result)) as T
    },
    [config.tag],
    {
      revalidate: config.revalidate,
      tags: config.tags ? [config.tag, ...config.tags] : [config.tag]
    }
  )()

  requestCache.set(config.tag, promise)
  return promise
}

// Called after collection mutations (create, update, delete).
// The group tag `collections-${userId}` sweeps all collection cache entries automatically —
// no need to enumerate specific tags here when adding new collection caches.
export function invalidateCollectionsCache(userId: string): void {
  revalidateTag(`collections-${userId}`)
  revalidatePath('/dashboard')
  revalidatePath('/collections', 'layout')
  revalidatePath('/favorites')
  log.info(`INVALIDATED collections for user:${userId}`)
}

// Called after profile mutations (password change, unlink provider).
export function invalidateProfileCache(userId: string): void {
  revalidateTag(CacheTags.profile(userId).tag)
  revalidatePath('/profile', 'page')
  log.info(`INVALIDATED profile for user:${userId}`)
}

// Called after item mutations (create, update, delete).
// Any cache entry that includes `items-${userId}` in its tags is swept automatically —
// no need to enumerate specific tags here when adding new item caches.
export function invalidateItemsCache(userId?: string): void {
  if (userId) {
    revalidateTag(`items-${userId}`)
  }
  revalidatePath('/dashboard')
  revalidatePath('/items')
  revalidatePath('/collections', 'layout')
  revalidatePath('/favorites')
  log.info(`INVALIDATED items for user:${userId ?? 'all'}`)
}
