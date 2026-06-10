import { prisma } from '@/lib/infra/prisma'
import { SIDEBAR_COLLECTION_SELECT, mapSidebarCollection } from '@/lib/db/collections'
import type { SearchResultItem } from '@/types/item'
import type { SidebarCollection } from '@/types/collection'

const SEARCH_ITEM_SELECT = {
  id: true,
  title: true,
  description: true,
  itemType: { select: { name: true } },
} as const

type SearchItemRow = {
  id: string
  title: string
  description: string | null
  itemType: SearchResultItem['itemType']
}

function toSearchResultItem(row: SearchItemRow): SearchResultItem {
  return {
    id: row.id,
    title: row.title,
    itemType: row.itemType,
    descriptionPreview: row.description ? row.description.slice(0, 150) : null,
  }
}

export async function globalSearch(query: string, userId: string): Promise<[SearchResultItem[], SidebarCollection[]]> {
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
      select: SEARCH_ITEM_SELECT,
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
      select: SIDEBAR_COLLECTION_SELECT,
      take: 10,
      orderBy: { updatedAt: 'desc' },
    }),
  ])

  return [itemRows.map(toSearchResultItem), collectionRows.map(mapSidebarCollection)]
}
