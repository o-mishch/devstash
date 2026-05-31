'use server'

import { z } from 'zod'
import { ApiResponse } from '@/lib/api'
import { withAuth } from '@/lib/session'
import { parseOrFail } from '@/lib/utils/validators'
import { createLogger } from '@/lib/logger'
import type { ApiBody } from '@/types/api'
import type { LightItem } from '@/types/item'
import type { CollectionWithTypes } from '@/types/collection'
import { toLightItem } from '@/lib/db/items'
import { mapCollection } from '@/lib/db/collections'
import { globalSearch } from '@/lib/db/search'

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
    const [itemsData, collectionsData] = await globalSearch(query, userId)

    const items = itemsData.map(toLightItem)
    const collections = collectionsData.map(mapCollection)

    log.info(`global search query: "${query}" user:${userId}`)

    return ApiResponse.OK({ items, collections })
  }, 'globalSearchAction')
}
