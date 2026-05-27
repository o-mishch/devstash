import { invalidateCache, CacheKeys } from '@/lib/redis-cache'

// Called after any item mutation (create / update / delete / pin / favorite).
// When items CRUD is built, add CacheKeys.itemsByType invalidation there too
// since we'd need to know the type name for targeted key deletion.
export async function invalidateItemsCache(userId: string): Promise<void> {
  await invalidateCache(
    CacheKeys.pinnedItems(userId),
    CacheKeys.recentItems(userId),
    CacheKeys.itemStats(userId),
    CacheKeys.sidebarTypes(userId),
  )
}

// Called after any collection mutation (create / update / delete / favorite).
export async function invalidateCollectionsCache(userId: string): Promise<void> {
  await invalidateCache(
    CacheKeys.allCollections(userId),
    CacheKeys.collectionStats(userId),
  )
}

// Called after profile mutations (password change, unlink provider).
export async function invalidateProfileCache(userId: string): Promise<void> {
  await invalidateCache(CacheKeys.profile(userId))
}
