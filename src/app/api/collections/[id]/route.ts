import { authedRouteWithParams } from '@/lib/api/route'
import { json, noContent, problem, parseOr422 } from '@/lib/api/http'
import { updateCollectionInput } from '@/lib/api/schemas/collections'
import { idParam } from '@/lib/api/schemas/common'
import { ErrorMessage } from '@/lib/api/error-messages'
import { getCollectionById, updateCollection, deleteCollection } from '@/lib/db/collections'
import { invalidateCollectionsCache } from '@/lib/infra/cache'
import { logger } from '@/lib/infra/pino'

const log = logger.child({ tag: 'api-collections' })

type RouteParams = Awaited<RouteContext<'/api/collections/[id]'>['params']>

export const GET = authedRouteWithParams<RouteParams>({}, async ({ userId, params }) => {
  const parsedParams = parseOr422(idParam, params)
  if (!parsedParams.ok) return parsedParams.res
  const { id } = parsedParams.data

  const collection = await getCollectionById(userId, id)
  if (!collection) {
    return problem(404, ErrorMessage.COLLECTION_NOT_FOUND)
  }
  return json(collection)
})

export const PATCH = authedRouteWithParams<RouteParams>({}, async ({ userId, params, request }) => {
  const parsedParams = parseOr422(idParam, params)
  if (!parsedParams.ok) return parsedParams.res
  const { id } = parsedParams.data

  const parsed = parseOr422(updateCollectionInput, await request.json())
  if (!parsed.ok) return parsed.res

  const updated = await updateCollection(userId, id, parsed.data)
  if (!updated) {
    return problem(404, ErrorMessage.COLLECTION_NOT_FOUND)
  }

  invalidateCollectionsCache(userId)
  log.info({ userId, id }, 'Collection updated')
  return json(updated)
})

export const DELETE = authedRouteWithParams<RouteParams>({}, async ({ userId, params }) => {
  const parsedParams = parseOr422(idParam, params)
  if (!parsedParams.ok) return parsedParams.res
  const { id } = parsedParams.data

  const deleted = await deleteCollection(userId, id)
  if (!deleted) {
    return problem(404, ErrorMessage.COLLECTION_NOT_FOUND)
  }

  invalidateCollectionsCache(userId)
  log.info({ userId, id }, 'Collection deleted')
  return noContent()
})
