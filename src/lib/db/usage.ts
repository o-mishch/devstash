import { prisma } from '@/lib/prisma'

export async function getUserUsageStats(userId: string) {
  const [itemsCount, collectionsCount] = await Promise.all([
    prisma.item.count({ where: { userId } }),
    prisma.collection.count({ where: { userId } }),
  ])
  return { itemsCount, collectionsCount }
}

export async function countItemsByUserId(userId: string): Promise<number> {
  return prisma.item.count({ where: { userId } })
}

export async function countCollectionsByUserId(userId: string): Promise<number> {
  return prisma.collection.count({ where: { userId } })
}
