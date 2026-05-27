import { unstable_cache, revalidateTag } from 'next/cache'

export interface DataCacheConfig {
  tag: string
  revalidate: number
}

export const CacheRevalidate = {
  items:       60,
  collections: 60,
  profile:     300,
  itemTypes:   3600,
} as const

export const CacheTags = {
  pinnedItems:    (userId: string)               => ({ tag: `user:${userId}:pinned-items`,     revalidate: CacheRevalidate.items }),
  recentItems:    (userId: string)               => ({ tag: `user:${userId}:recent-items`,      revalidate: CacheRevalidate.items }),
  itemsByType:    (userId: string, type: string) => ({ tag: `user:${userId}:items:${type}`,     revalidate: CacheRevalidate.items }),
  itemStats:      (userId: string)               => ({ tag: `user:${userId}:item-stats`,         revalidate: CacheRevalidate.items }),
  sidebarTypes:   (userId: string)               => ({ tag: `user:${userId}:sidebar-types`,     revalidate: CacheRevalidate.items }),
  allCollections: (userId: string)               => ({ tag: `user:${userId}:collections`,        revalidate: CacheRevalidate.collections }),
  collectionStats:(userId: string)               => ({ tag: `user:${userId}:collection-stats`,  revalidate: CacheRevalidate.collections }),
  profile:        (userId: string)               => ({ tag: `user:${userId}:profile`,            revalidate: CacheRevalidate.profile }),
  itemTypeBySlug: (slug: string)                 => ({ tag: `item-type:slug:${slug}`,            revalidate: CacheRevalidate.itemTypes }),
  systemItemTypes:()                             => ({ tag: `system-item-types`,                 revalidate: CacheRevalidate.itemTypes }),
} as const

export async function withDataCache<T>(
  config: DataCacheConfig,
  fetcher: () => Promise<T>
): Promise<T> {
  const cachedFetcher = unstable_cache(
    fetcher,
    [config.tag],
    {
      revalidate: config.revalidate,
      tags: [config.tag]
    }
  )

  return cachedFetcher()
}

export async function invalidateDataCache(...configs: DataCacheConfig[]): Promise<void> {
  if (!configs.length) return
  
  // Invalidate Next.js Data Cache
  configs.forEach((c) => {
    try {
      revalidateTag(c.tag, {})
    } catch {
      // revalidateTag must be called within Server Action or Route Handler context
    }
  })
}

// Called after any item mutation (create / update / delete / pin / favorite).
// When items CRUD is built, add CacheTags.itemsByType invalidation there too
// since we'd need to know the type name for targeted tag deletion.
export async function invalidateItemsCache(userId: string): Promise<void> {
  await invalidateDataCache(
    CacheTags.pinnedItems(userId),
    CacheTags.recentItems(userId),
    CacheTags.itemStats(userId),
    CacheTags.sidebarTypes(userId),
  )
}

// Called after any collection mutation (create / update / delete / favorite).
export async function invalidateCollectionsCache(userId: string): Promise<void> {
  await invalidateDataCache(
    CacheTags.allCollections(userId),
    CacheTags.collectionStats(userId),
  )
}

// Called after profile mutations (password change, unlink provider).
export async function invalidateProfileCache(userId: string): Promise<void> {
  await invalidateDataCache(CacheTags.profile(userId))
}
