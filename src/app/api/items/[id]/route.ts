import { authedRouteWithParams } from '@/lib/api/route'
import { json, noContent, problem, parseOr422 } from '@/lib/api/http'
import { updateItemInput } from '@/lib/api/schemas/items'
import { idParam } from '@/lib/api/schemas/common'
import { ErrorMessage } from '@/lib/api/error-messages'
import { getItemForAuth, getItemById, updateItem, deleteItem } from '@/lib/db/items'
import { invalidateCollectionsCache, invalidateItemsCache } from '@/lib/infra/cache'
import { deleteStoredFile } from '@/lib/storage/image-thumbnails'
import { PRO_ITEM_TYPE_NAMES, PRO_ITEM_TYPE_NAMES_LABEL, TEXT_ITEM_TYPE_NAMES } from '@/lib/utils/constants'
import { logger } from '@/lib/infra/pino'

const log = logger.child({ tag: 'api-items' })

type RouteParams = Awaited<RouteContext<'/api/items/[id]'>['params']>

// Single item by id (IDOR-scoped). Powers the source deep-link: opening /items/[type]?item=<id> fetches
// the item and pops its detail drawer. Returns the LightItem shape the drawer is seeded with.
export const GET = authedRouteWithParams<RouteParams>({}, async ({ userId, params }) => {
  const parsedParams = parseOr422(idParam, params)
  if (!parsedParams.ok) return parsedParams.res
  const { id } = parsedParams.data

  const item = await getItemById(userId, id)
  if (!item) return problem(404, ErrorMessage.ITEM_NOT_FOUND)
  return json(item)
})

export const PATCH = authedRouteWithParams<RouteParams>(
  { rateLimit: 'itemMutation' },
  async ({ userId, isPro, params, request }) => {
    const parsedParams = parseOr422(idParam, params)
    if (!parsedParams.ok) return parsedParams.res
    const { id } = parsedParams.data

    const parsed = parseOr422(updateItemInput, await request.json())
    if (!parsed.ok) return parsed.res

    const existing = await getItemForAuth(userId, id)
    if (!existing) return problem(404, ErrorMessage.ITEM_NOT_FOUND)

    if (PRO_ITEM_TYPE_NAMES.has(existing.itemType.name) && !isPro) {
      return problem(403, `Upgrade to Pro to edit ${PRO_ITEM_TYPE_NAMES_LABEL}.`)
    }

    // v3 live type change is only valid among text types. The schema enum already rejects any non-text
    // *target* (link/file/image) at parse with a 422 — this guard covers the *source*: re-typing a
    // file/image/link item would strand contentType/fileUrl/url, so block it here too.
    if (parsed.data.itemTypeName !== undefined && !TEXT_ITEM_TYPE_NAMES.has(existing.itemType.name)) {
      return problem(422, `Cannot change the type of a ${existing.itemType.name} item.`)
    }

    const updated = await updateItem(userId, id, parsed.data)
    if (!updated) return problem(404, ErrorMessage.ITEM_NOT_FOUND)

    invalidateItemsCache(userId)
    invalidateCollectionsCache(userId)
    log.info({ userId, itemId: id }, 'Item updated')
    return json(updated)
  },
)

export const DELETE = authedRouteWithParams<RouteParams>(
  { rateLimit: 'itemMutation' },
  async ({ userId, params }) => {
    const parsedParams = parseOr422(idParam, params)
    if (!parsedParams.ok) return parsedParams.res
    const { id } = parsedParams.data

    const existing = await getItemForAuth(userId, id)
    if (!existing) return problem(404, ErrorMessage.ITEM_NOT_FOUND)

    if (existing.fileUrl) {
      try {
        await deleteStoredFile(existing.fileUrl)
      } catch (error) {
        log.error({ userId, itemId: id, err: error }, 'Failed to delete file from storage')
        return problem(500, 'Failed to delete file from storage.')
      }
    }

    if (!(await deleteItem(userId, id))) {
      return problem(500, 'Failed to delete item.')
    }

    invalidateItemsCache(userId)
    invalidateCollectionsCache(userId)
    log.info({ userId, itemId: id }, 'Item deleted')
    return noContent()
  },
)
