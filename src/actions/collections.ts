'use server'

import { z } from 'zod'
import { ApiResponse } from '@/lib/api'
import { withAuth } from '@/lib/session'
import { parseOrFail, collectionFormSchema } from '@/lib/utils/validators'
import {
  createCollection as dbCreateCollection,
  updateCollection as dbUpdateCollection,
  deleteCollection as dbDeleteCollection
} from '@/lib/db/collections'
import { invalidateCollectionsCache } from '@/lib/cache'
import type { ApiBody } from '@/types/api'
import type { CollectionWithTypes } from '@/types/collection'
import type { CreateCollectionInput, UpdateCollectionInput } from '@/lib/db/collections'

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

const updateCollectionSchema = collectionFormSchema.partial().extend({
  isFavorite: z.boolean().optional(),
})

export async function updateCollectionAction(collectionId: string, raw: UpdateCollectionInput): Promise<ApiBody<CollectionWithTypes | null>> {
  return withAuth(async (userId) => {
    const result = parseOrFail(updateCollectionSchema, raw)
    if (!result.success) return result.response

    try {
      const updated = await dbUpdateCollection(userId, collectionId, result.data)
      invalidateCollectionsCache(userId)
      return ApiResponse.OK(updated)
    } catch (error) {
      console.error('[updateCollectionAction] Error:', error)
      return ApiResponse.INTERNAL_ERROR()
    }
  })
}

export async function deleteCollectionAction(collectionId: string): Promise<ApiBody<null>> {
  return withAuth(async (userId) => {
    try {
      await dbDeleteCollection(userId, collectionId)
      invalidateCollectionsCache(userId)
      return ApiResponse.OK(null)
    } catch (error) {
      console.error('[deleteCollectionAction] Error:', error)
      return ApiResponse.INTERNAL_ERROR()
    }
  })
}
