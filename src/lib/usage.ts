import { getUserUsageStats, countItemsByUserId, countCollectionsByUserId } from '@/lib/db/usage'

export { getUserUsageStats as getUserUsage }

export const FREE_TIER_ITEM_LIMIT = 50
export const FREE_TIER_COLLECTION_LIMIT = 3

export async function canCreateItem(userId: string, isPro: boolean): Promise<boolean> {
  if (isPro) return true
  const count = await countItemsByUserId(userId)
  return count < FREE_TIER_ITEM_LIMIT
}

export async function canCreateCollection(userId: string, isPro: boolean): Promise<boolean> {
  if (isPro) return true
  const count = await countCollectionsByUserId(userId)
  return count < FREE_TIER_COLLECTION_LIMIT
}
