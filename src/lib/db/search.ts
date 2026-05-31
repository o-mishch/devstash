import { prisma } from '@/lib/prisma'
import { LIGHT_ITEM_SELECT } from '@/lib/db/items'
import { COLLECTION_INCLUDE } from '@/lib/db/collections'

export async function globalSearch(query: string, userId: string) {
  return Promise.all([
    prisma.item.findMany({
      where: {
        userId,
        OR: [
          { title: { contains: query, mode: 'insensitive' } },
          { description: { contains: query, mode: 'insensitive' } },
          { content: { contains: query, mode: 'insensitive' } },
        ],
      },
      select: LIGHT_ITEM_SELECT,
      take: 20,
      orderBy: { updatedAt: 'desc' },
    }),
    prisma.collection.findMany({
      where: {
        userId,
        OR: [
          { name: { contains: query, mode: 'insensitive' } },
          { description: { contains: query, mode: 'insensitive' } },
        ],
      },
      include: COLLECTION_INCLUDE,
      take: 10,
      orderBy: { updatedAt: 'desc' },
    }),
  ])
}
