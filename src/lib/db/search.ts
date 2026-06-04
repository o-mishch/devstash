import { prisma } from '@/lib/prisma'
import { LIGHT_ITEM_SELECT, fetchItemPreviews, toLightItem } from '@/lib/db/items'
import { COLLECTION_SELECT, mapCollection } from '@/lib/db/collections'
import type { LightItem } from '@/types/item'
import type { CollectionWithTypes } from '@/types/collection'

export async function globalSearch(query: string, userId: string): Promise<[LightItem[], CollectionWithTypes[]]> {
  const [itemRows, collectionRows] = await Promise.all([
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
      select: COLLECTION_SELECT,
      take: 10,
      orderBy: { updatedAt: 'desc' },
    }),
  ])

  const previews = await fetchItemPreviews(itemRows.map((r) => r.id))
  const items = itemRows.map((r) => toLightItem(r, previews.get(r.id)))
  return [items, collectionRows.map(mapCollection)]
}
