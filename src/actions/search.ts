'use server'

import { z } from 'zod'
import { ApiResponse } from '@/lib/api'
import { withAuth } from '@/lib/session'
import { parseOrFail } from '@/lib/utils/validators'
import { prisma } from '@/lib/prisma'
import { createLogger } from '@/lib/logger'
import type { ApiBody } from '@/types/api'
import type { LightItem } from '@/types/item'
import type { CollectionWithTypes } from '@/types/collection'
import { LIGHT_ITEM_SELECT, toLightItem } from '@/lib/db/items'
import { mapCollection, COLLECTION_INCLUDE } from '@/lib/db/collections'

const log = createLogger('search')

const searchSchema = z.object({
  query: z.string().trim().min(1, 'Search query is required'),
})

export interface SearchResult {
  items: LightItem[]
  collections: CollectionWithTypes[]
}

export async function globalSearchAction(raw: { query: string }): Promise<ApiBody<SearchResult | null>> {
  return withAuth(async (userId) => {
    const result = parseOrFail(searchSchema, raw)
    if (!result.success) return result.response

    const { query } = result.data

    // Use contains with insensitive mode to leverage pg_trgm GIN indexes for fuzzy substring matching
    const [itemsData, collectionsData] = await Promise.all([
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

    const items = itemsData.map(toLightItem)
    const collections = collectionsData.map(mapCollection)

    log.info(`global search query: "${query}" user:${userId}`)

    return ApiResponse.OK({ items, collections })
  }, 'globalSearchAction')
}
