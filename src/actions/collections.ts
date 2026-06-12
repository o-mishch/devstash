'use server'

import { z } from 'zod'
import { ApiResponse } from '@/lib/api'
import { withAuth, withValidatedAuth } from '@/lib/session'
import { createToggleAction } from '@/lib/app/action-utils'
import { canCreateCollection } from '@/lib/db/usage'
import { collectionFormSchema } from '@/lib/utils/validators'
import {
  createCollection as dbCreateCollection,
  updateCollection as dbUpdateCollection,
  deleteCollection as dbDeleteCollection,
  toggleCollectionFavorite as dbToggleCollectionFavorite,
  getAllCollections as dbGetAllCollections
} from '@/lib/db/collections'
import { createLogger } from '@/lib/infra/logger'
import { invalidateCollectionsCache } from '@/lib/infra/cache'
import type { ApiBody } from '@/types/api'
import type { CollectionWithTypes } from '@/types/collection'
import type { CreateCollectionInput, UpdateCollectionInput } from '@/lib/db/collections'

const log = createLogger('collections')

export async function createCollectionAction(raw: CreateCollectionInput): Promise<ApiBody<CollectionWithTypes | null>> {
  return withValidatedAuth(collectionFormSchema, raw, async ({ userId, isPro }, data: CreateCollectionInput) => {
    const canCreate = await canCreateCollection(userId, isPro)
    if (!canCreate) {
      return ApiResponse.FORBIDDEN('You have reached your free tier limit of 3 collections. Please upgrade to Pro.')
    }

    const created = await dbCreateCollection(userId, data)
    invalidateCollectionsCache(userId)
    log.info(`created "${data.name}" user:${userId}`)
    return ApiResponse.CREATED(created)
  }, 'createCollectionAction')
}

const updateCollectionSchema = collectionFormSchema.partial().extend({
  isFavorite: z.boolean().optional(),
})

export async function updateCollectionAction(collectionId: string, raw: UpdateCollectionInput): Promise<ApiBody<CollectionWithTypes | null>> {
  return withValidatedAuth(updateCollectionSchema, raw, async ({ userId }, data: UpdateCollectionInput) => {
    const updated = await dbUpdateCollection(userId, collectionId, data)
    invalidateCollectionsCache(userId)
    log.info(`updated collection:${collectionId} user:${userId}`)
    return ApiResponse.OK(updated)
  }, 'updateCollectionAction')
}

export async function deleteCollectionAction(collectionId: string): Promise<ApiBody<null>> {
  return withAuth(async ({ userId }) => {
    await dbDeleteCollection(userId, collectionId)
    invalidateCollectionsCache(userId)
    log.info(`deleted collection:${collectionId} user:${userId}`)
    return ApiResponse.OK()
  }, 'deleteCollectionAction')
}

export const toggleCollectionFavoriteAction = createToggleAction(dbToggleCollectionFavorite, invalidateCollectionsCache, 'collection')

export async function getCollectionPickerItemsAction(): Promise<ApiBody<CollectionWithTypes[]>> {
  return withAuth(async ({ userId }) => {
    const collections = await dbGetAllCollections(userId)
    return ApiResponse.OK(collections)
  }, 'getCollectionPickerItemsAction')
}
