import { authedRouteWithParams, type IdParam } from '@/lib/api/route'
import { json, noContent, problem, parseOr422 } from '@/lib/api/http'
import { updateCollectionInput } from '@/lib/api/schemas/collections'
import { ErrorMessage } from '@/lib/api/error-messages'
import { getCollectionById, updateCollection, deleteCollection } from '@/lib/db/collections'
import { invalidateCollectionsCache } from '@/lib/infra/cache'
import { logger } from '@/lib/infra/pino'

const log = logger.child({ tag: 'api-collections' })

export const PATCH = authedRouteWithParams<IdParam>({}, async ({ userId, params, request }) => {
  const parsed = parseOr422(updateCollectionInput, await request.json())
  if (!parsed.ok) return parsed.res

  if (!(await getCollectionById(userId, params.id))) {
    return problem(404, ErrorMessage.COLLECTION_NOT_FOUND)
  }

  const updated = await updateCollection(userId, params.id, parsed.data)
  invalidateCollectionsCache(userId)
  log.info({ userId, id: params.id }, 'Collection updated')
  return json(updated)
})

export const DELETE = authedRouteWithParams<IdParam>({}, async ({ userId, params }) => {
  if (!(await getCollectionById(userId, params.id))) {
    return problem(404, ErrorMessage.COLLECTION_NOT_FOUND)
  }

  await deleteCollection(userId, params.id)
  invalidateCollectionsCache(userId)
  log.info({ userId, id: params.id }, 'Collection deleted')
  return noContent()
})
