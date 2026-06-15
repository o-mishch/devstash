import 'server-only'
import { z } from 'zod'
import { authenticatedRoute, ApiResponse } from '@/lib/api'
import { parseOrFail, collectionFormSchema } from '@/lib/utils/validators'
import {
  updateCollection as dbUpdateCollection,
  deleteCollection as dbDeleteCollection,
  getCollectionById,
} from '@/lib/db/collections'
import { invalidateCollectionsCache } from '@/lib/infra/cache'
import { logger } from '@/lib/infra/pino'

const log = logger.child({ tag: 'api-collections-id' })

const updateCollectionSchema = collectionFormSchema.partial().extend({
  isFavorite: z.boolean().optional(),
})

export const PATCH = authenticatedRoute(async (request, context, { userId }) => {
  const { id } = await context.params
  const body: unknown = await request.json()
  const parsed = parseOrFail(updateCollectionSchema, body)
  if (!parsed.success) return parsed.response

  const existing = await getCollectionById(userId, id)
  if (!existing) return ApiResponse.NOT_FOUND('Collection not found.')

  const updated = await dbUpdateCollection(userId, id, parsed.data)
  invalidateCollectionsCache(userId)
  log.info({ userId, id }, 'Collection updated')
  return ApiResponse.OK(updated)
})

export const DELETE = authenticatedRoute(async (_request, context, { userId }) => {
  const { id } = await context.params

  const existing = await getCollectionById(userId, id)
  if (!existing) return ApiResponse.NOT_FOUND('Collection not found.')

  await dbDeleteCollection(userId, id)
  invalidateCollectionsCache(userId)
  log.info({ userId, id }, 'Collection deleted')
  return ApiResponse.OK()
})
