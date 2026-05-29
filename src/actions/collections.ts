'use server'

import { ApiResponse } from '@/lib/api'
import { withAuth } from '@/lib/session'
import { parseOrFail, collectionFormSchema } from '@/lib/utils/validators'
import { createCollection as dbCreateCollection } from '@/lib/db/collections'
import { invalidateCollectionsCache } from '@/lib/cache'
import type { ApiBody } from '@/types/api'
import type { CollectionWithTypes } from '@/types/collection'
import type { CreateCollectionInput } from '@/lib/db/collections'

export async function createCollectionAction(raw: CreateCollectionInput): Promise<ApiBody<CollectionWithTypes | null>> {
  return withAuth(async (userId) => {
    const result = parseOrFail(collectionFormSchema, raw)
    if (!result.success) return result.response

    try {
      const created = await dbCreateCollection(userId, result.data)
      invalidateCollectionsCache(userId)
      return ApiResponse.CREATED(created)
    } catch (error) {
      console.error('[createCollectionAction] Error:', error)
      return ApiResponse.INTERNAL_ERROR()
    }
  })
}
