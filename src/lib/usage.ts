import { getUserUsageStats, countItemsByUserId, countCollectionsByUserId } from '@/lib/db/usage';

export const FREE_TIER_ITEM_LIMIT = 50;
export const FREE_TIER_COLLECTION_LIMIT = 3;

/**
 * Returns the current usage count for a user.
 */
export async function getUserUsage(userId: string) {
  return getUserUsageStats(userId);
}

/**
 * Validates if the user is allowed to create a new item.
 */
export async function canCreateItem(userId: string, isPro: boolean): Promise<boolean> {
  if (isPro) return true;
  const count = await countItemsByUserId(userId);
  return count < FREE_TIER_ITEM_LIMIT;
}

/**
 * Validates if the user is allowed to create a new collection.
 */
export async function canCreateCollection(userId: string, isPro: boolean): Promise<boolean> {
  if (isPro) return true;
  const count = await countCollectionsByUserId(userId);
  return count < FREE_TIER_COLLECTION_LIMIT;
}
