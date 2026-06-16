import { authedRouteWithParams, type IdParam } from '@/lib/api/route'
import { json, noContent, problem, parseOr422 } from '@/lib/api/http'
import { updateItemInput } from '@/lib/api/schemas/items'
import { ErrorMessage } from '@/lib/api/error-messages'
import { getItemForAuth, updateItem, deleteItem } from '@/lib/db/items'
import { invalidateCollectionsCache, invalidateItemsCache } from '@/lib/infra/cache'
import { deleteStoredFile } from '@/lib/storage/image-thumbnails'
import { PRO_ITEM_TYPE_NAMES, PRO_ITEM_TYPE_NAMES_LABEL } from '@/lib/utils/constants'
import { logger } from '@/lib/infra/pino'

const log = logger.child({ tag: 'api-items' })

export const PATCH = authedRouteWithParams<IdParam>(
  { rateLimit: 'itemMutation' },
  async ({ userId, isPro, params, request }) => {
    const parsed = parseOr422(updateItemInput, await request.json())
    if (!parsed.ok) return parsed.res

    const existing = await getItemForAuth(userId, params.id)
    if (!existing) return problem(404, ErrorMessage.ITEM_NOT_FOUND)

    if (PRO_ITEM_TYPE_NAMES.has(existing.itemType.name) && !isPro) {
      return problem(403, `Upgrade to Pro to edit ${PRO_ITEM_TYPE_NAMES_LABEL}.`)
    }

    const updated = await updateItem(userId, params.id, parsed.data)
    if (!updated) return problem(404, ErrorMessage.ITEM_NOT_FOUND)

    invalidateItemsCache(userId)
    invalidateCollectionsCache(userId)
    log.info({ userId, itemId: params.id }, 'Item updated')
    return json(updated)
  },
)

export const DELETE = authedRouteWithParams<IdParam>(
  { rateLimit: 'itemMutation' },
  async ({ userId, params }) => {
    const existing = await getItemForAuth(userId, params.id)
    if (!existing) return problem(404, ErrorMessage.ITEM_NOT_FOUND)

    if (existing.fileUrl) {
      try {
        await deleteStoredFile(existing.fileUrl)
      } catch (error) {
        log.error({ userId, itemId: params.id, err: error }, 'Failed to delete file from storage')
        return problem(500, 'Failed to delete file from storage.')
      }
    }

    if (!(await deleteItem(userId, params.id))) {
      return problem(500, 'Failed to delete item.')
    }

    invalidateItemsCache(userId)
    invalidateCollectionsCache(userId)
    log.info({ userId, itemId: params.id }, 'Item deleted')
    return noContent()
  },
)
