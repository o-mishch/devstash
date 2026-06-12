import 'server-only'

import { cacheTag, cacheLife } from 'next/cache'
import { prisma } from '@/lib/infra/prisma'
import { CacheTags } from '@/lib/infra/cache'
import { FREE_TIER_COLLECTION_LIMIT, FREE_TIER_ITEM_LIMIT } from '@/lib/utils/constants'
import { createLogger } from '@/lib/infra/logger'

export { FREE_TIER_COLLECTION_LIMIT, FREE_TIER_ITEM_LIMIT } from '@/lib/utils/constants'

const log = createLogger('db:usage')

export async function getUserUsageStats(userId: string) {
  const [itemsCount, collectionsCount] = await Promise.all([
    prisma.item.count({ where: { userId } }),
    prisma.collection.count({ where: { userId } }),
  ])
  return { itemsCount, collectionsCount }
}

export async function countItemsByUserId(userId: string): Promise<number> {
  'use cache'
  const cacheKey = CacheTags.usageItemCount(userId)
  cacheTag(cacheKey, CacheTags.itemGroup(userId))
  cacheLife('max')
  const start = Date.now()
  const count = await prisma.item.count({ where: { userId } })
  log.info('DB: countItemsByUserId', { userId, cacheKey, count, duration: Date.now() - start })
  return count
}

export async function countCollectionsByUserId(userId: string): Promise<number> {
  'use cache'
  const cacheKey = CacheTags.usageCollectionCount(userId)
  cacheTag(cacheKey, CacheTags.collectionGroup(userId))
  cacheLife('max')
  const start = Date.now()
  const count = await prisma.collection.count({ where: { userId } })
  log.info('DB: countCollectionsByUserId', { userId, cacheKey, count, duration: Date.now() - start })
  return count
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
