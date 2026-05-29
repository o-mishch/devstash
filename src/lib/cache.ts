import { unstable_cache, revalidatePath, updateTag } from 'next/cache'

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
  recentItems: (userId: string) => ({ tag: `user:${userId}:recent-items`, revalidate: CacheRevalidate.items, tags: [`items-${userId}`] }),
  itemsByType: (userId: string, type: string) => ({ tag: `user:${userId}:items:${type}`, revalidate: CacheRevalidate.items, tags: [`items-${userId}`] }),
  itemStats: (userId: string) => ({ tag: `user:${userId}:item-stats`, revalidate: CacheRevalidate.items, tags: [`items-${userId}`] }),
  sidebarTypes: (userId: string) => ({ tag: `user:${userId}:sidebar-types`, revalidate: CacheRevalidate.items, tags: [`items-${userId}`] }),
  allCollections: (userId: string) => ({ tag: `user:${userId}:collections`, revalidate: CacheRevalidate.collections }),
  collectionById: (userId: string, collectionId: string) => ({ tag: `user:${userId}:collection:${collectionId}`, revalidate: CacheRevalidate.collections }),
  itemsByCollection: (userId: string, collectionId: string) => ({ tag: `user:${userId}:collection:${collectionId}:items`, revalidate: CacheRevalidate.items, tags: [`items-${userId}`] }),
  collectionStats: (userId: string) => ({ tag: `user:${userId}:collection-stats`, revalidate: CacheRevalidate.collections }),
  profile: (userId: string) => ({ tag: `user:${userId}:profile`, revalidate: CacheRevalidate.profile }),
  itemTypeBySlug: (slug: string) => ({ tag: `item-type:slug:${slug}`, revalidate: CacheRevalidate.itemTypes }),
  systemItemTypes: () => ({ tag: `system-item-types`, revalidate: CacheRevalidate.itemTypes }),
} as const

export async function withDataCache<T>(
  config: DataCacheConfig,
  fetcher: () => Promise<T>
): Promise<T> {
  const cachedFetcher = unstable_cache(
    async () => {
      console.log('❌ CACHE MISS OR REVALIDATION:', config.tag)
      const start = Date.now()
      const result = await fetcher()
      console.log(`✅ FETCHED ${config.tag} in ${Date.now() - start}ms`)
      // Strip Prisma proxies and non-serializable objects to guarantee successful caching
      return JSON.parse(JSON.stringify(result)) as T
    },
    [config.tag],
    {
      revalidate: config.revalidate,
      tags: config.tags ? [config.tag, ...config.tags] : [config.tag]
    }
  )

  return cachedFetcher()
}

// Called after collection mutations (create, update, delete).
export function invalidateCollectionsCache(userId: string): void {
  updateTag(CacheTags.allCollections(userId).tag)
  updateTag(CacheTags.collectionStats(userId).tag)
  revalidatePath('/dashboard')
  revalidatePath('/collections')
}

// Called after profile mutations (password change, unlink provider).
export function invalidateProfileCache(userId: string): void {
  updateTag(CacheTags.profile(userId).tag)
  revalidatePath('/profile', 'page')
}

// Called after item mutations (create, update, delete).
// Any cache entry that includes `items-${userId}` in its tags is swept automatically —
// no need to enumerate specific tags here when adding new item caches.
export function invalidateItemsCache(userId?: string): void {
  if (userId) {
    updateTag(`items-${userId}`)
  }
  revalidatePath('/dashboard')
  revalidatePath('/items')
  revalidatePath('/collections', 'layout')
}
