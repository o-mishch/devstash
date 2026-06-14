import 'server-only'
import { authenticatedRoute, ApiResponse } from '@/lib/api'
import { parseOrFail, itemMutationSchema } from '@/lib/utils/validators'
import {
  updateItem as dbUpdateItem,
  deleteItem as dbDeleteItem,
  getItemForAuth as dbGetItemForAuth,
} from '@/lib/db/items'
import { invalidateCollectionsCache, invalidateItemsCache } from '@/lib/infra/cache'
import { deleteStoredFile } from '@/lib/storage/image-thumbnails'
import { PRO_ITEM_TYPE_NAMES, PRO_ITEM_TYPE_NAMES_LABEL } from '@/lib/utils/constants'
import { createLogger } from '@/lib/infra/logger'

const log = createLogger('api-items-id')

export const PATCH = authenticatedRoute(async (request, context, { userId, isPro }) => {
  const { id } = await context.params
  const body: unknown = await request.json()
  const parsed = parseOrFail(itemMutationSchema, body)
  if (!parsed.success) return parsed.response

  const existing = await dbGetItemForAuth(userId, id)
  if (!existing) return ApiResponse.NOT_FOUND('Item not found.')

  if (PRO_ITEM_TYPE_NAMES.has(existing.itemType.name) && !isPro) {
    return ApiResponse.FORBIDDEN(`Upgrade to Pro to edit ${PRO_ITEM_TYPE_NAMES_LABEL}.`)
  }

  const updated = await dbUpdateItem(userId, id, parsed.data)
  if (!updated) return ApiResponse.NOT_FOUND('Item not found.')

  invalidateItemsCache(userId)
  invalidateCollectionsCache(userId)
  log.info('Item updated', { userId, itemId: id })
  return ApiResponse.OK(updated)
})

export const DELETE = authenticatedRoute(async (_request, context, { userId }) => {
  const { id } = await context.params

  const existing = await dbGetItemForAuth(userId, id)
  if (!existing) return ApiResponse.NOT_FOUND('Item not found.')

  if (existing.fileUrl) {
    try {
      await deleteStoredFile(existing.fileUrl)
    } catch (error) {
      log.error('Failed to delete file from storage', { userId, itemId: id, error })
      return ApiResponse.INTERNAL_ERROR('Failed to delete file from storage.')
    }
  }

  const deleted = await dbDeleteItem(userId, id)
  if (!deleted) return ApiResponse.INTERNAL_ERROR('Failed to delete item.')

  invalidateItemsCache(userId)
  invalidateCollectionsCache(userId)

  log.info('Item deleted', { userId, itemId: id })
  return ApiResponse.OK()
})
