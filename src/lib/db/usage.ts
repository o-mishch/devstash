import 'server-only'

import { cacheTag, cacheLife } from 'next/cache'
import { prisma } from '@/lib/infra/prisma'
import { CacheTags } from '@/lib/infra/cache'
import { FREE_TIER_COLLECTION_LIMIT, FREE_TIER_ITEM_LIMIT } from '@/lib/utils/constants'
import { logger } from '@/lib/infra/pino'

export { FREE_TIER_COLLECTION_LIMIT, FREE_TIER_ITEM_LIMIT } from '@/lib/utils/constants'

const log = logger.child({ tag: 'db:usage' })

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
  log.info({ userId, cacheKey, count, duration: Date.now() - start }, 'DB: countItemsByUserId')
  return count
}

export async function countCollectionsByUserId(userId: string): Promise<number> {
  'use cache'
  const cacheKey = CacheTags.usageCollectionCount(userId)
  cacheTag(cacheKey, CacheTags.collectionGroup(userId))
  cacheLife('max')
  const start = Date.now()
  const count = await prisma.collection.count({ where: { userId } })
  log.info({ userId, cacheKey, count, duration: Date.now() - start }, 'DB: countCollectionsByUserId')
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
