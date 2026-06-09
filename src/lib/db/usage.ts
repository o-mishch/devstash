import { prisma } from '@/lib/infra/prisma'
import { FREE_TIER_COLLECTION_LIMIT, FREE_TIER_ITEM_LIMIT } from '@/lib/utils/constants'

export { FREE_TIER_COLLECTION_LIMIT, FREE_TIER_ITEM_LIMIT } from '@/lib/utils/constants'

export async function getUserUsageStats(userId: string) {
  const [itemsCount, collectionsCount] = await Promise.all([
    prisma.item.count({ where: { userId } }),
    prisma.collection.count({ where: { userId } }),
  ])
  return { itemsCount, collectionsCount }
}

export const getUserUsage = getUserUsageStats

export async function countItemsByUserId(userId: string): Promise<number> {
  return prisma.item.count({ where: { userId } })
}

export async function countCollectionsByUserId(userId: string): Promise<number> {
  return prisma.collection.count({ where: { userId } })
}

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
