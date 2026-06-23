import 'server-only'

import { prisma } from '@/lib/infra/prisma'
import { SIDEBAR_COLLECTION_SELECT, mapSidebarCollection } from '@/lib/db/collections'
import { LIGHT_ITEM_SELECT, toLightItem, fetchTextPreviews } from '@/lib/db/items'
import type { LightItem } from '@/types/item'
import type { SidebarCollection } from '@/types/collection'

// Intentionally uncached: live search must reflect the latest committed items/collections, so the
// freshness exception in database.md applies (no 'use cache').
export async function globalSearch(query: string, userId: string): Promise<[LightItem[], SidebarCollection[]]> {
  const [itemRows, collectionRows] = await Promise.all([
    prisma.item.findMany({
      where: {
        userId,
        OR: [
          { title: { contains: query, mode: 'insensitive' } },
          { description: { contains: query, mode: 'insensitive' } },
          { content: { contains: query, mode: 'insensitive' } },
          { tags: { some: { name: { contains: query, mode: 'insensitive' } } } },
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
      select: SIDEBAR_COLLECTION_SELECT,
      take: 10,
      orderBy: { updatedAt: 'desc' },
    }),
  ])

  // Return full LightItems (same shape as the item list) so the drawer opens with every field —
  // fileName/fileSize/url/tags — populated, not the lossy slim hit it used to get.
  const textPreviews = await fetchTextPreviews(itemRows.map((r) => r.id))
  return [itemRows.map((r) => toLightItem(r, textPreviews)), collectionRows.map((col) => mapSidebarCollection(col))]
}
