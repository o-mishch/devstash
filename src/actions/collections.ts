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
import { createLogger } from '@/lib/logger'
import type { ApiBody } from '@/types/api'
import type { CollectionWithTypes } from '@/types/collection'
import type { CreateCollectionInput, UpdateCollectionInput } from '@/lib/db/collections'

const log = createLogger('collections')

export async function createCollectionAction(raw: CreateCollectionInput): Promise<ApiBody<CollectionWithTypes | null>> {
  return withAuth(async (userId) => {
    const result = parseOrFail(collectionFormSchema, raw)
    if (!result.success) return result.response

    const created = await dbCreateCollection(userId, result.data)
    invalidateCollectionsCache(userId)
    log.info(`created "${result.data.name}" user:${userId}`)
    return ApiResponse.CREATED(created)
  }, 'createCollectionAction')
}

const updateCollectionSchema = collectionFormSchema.partial().extend({
  isFavorite: z.boolean().optional(),
})

export async function updateCollectionAction(collectionId: string, raw: UpdateCollectionInput): Promise<ApiBody<CollectionWithTypes | null>> {
  return withAuth(async (userId) => {
    const result = parseOrFail(updateCollectionSchema, raw)
    if (!result.success) return result.response

    const updated = await dbUpdateCollection(userId, collectionId, result.data)
    invalidateCollectionsCache(userId)
    log.info(`updated collection:${collectionId} user:${userId}`)
    return ApiResponse.OK(updated)
  }, 'updateCollectionAction')
}

export async function deleteCollectionAction(collectionId: string): Promise<ApiBody<null>> {
  return withAuth(async (userId) => {
    await dbDeleteCollection(userId, collectionId)
    invalidateCollectionsCache(userId)
    log.info(`deleted collection:${collectionId} user:${userId}`)
    return ApiResponse.OK()
  }, 'deleteCollectionAction')
}
