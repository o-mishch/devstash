import { authedRouteWithParams } from '@/lib/api/route'
import { noContent, problem, parseOr422 } from '@/lib/api/http'
import { toggleFavoriteInput, idParam } from '@/lib/api/schemas/common'
import { ErrorMessage } from '@/lib/api/error-messages'
import { toggleCollectionFavorite } from '@/lib/db/collections'
import { invalidateCollectionsCache } from '@/lib/infra/cache'
import { logger } from '@/lib/infra/pino'

const log = logger.child({ tag: 'api-collections' })

type RouteParams = Awaited<RouteContext<'/api/collections/[id]/favorite'>['params']>

export const PATCH = authedRouteWithParams<RouteParams>({}, async ({ userId, params, request }) => {
  const parsedParams = parseOr422(idParam, params)
  if (!parsedParams.ok) return parsedParams.res
  const { id } = parsedParams.data

  const parsed = parseOr422(toggleFavoriteInput, await request.json())
  if (!parsed.ok) return parsed.res

  // toggleCollectionFavorite scopes to userId and returns false when the row doesn't exist.
  if (!(await toggleCollectionFavorite(userId, id, parsed.data.isFavorite))) {
    return problem(404, ErrorMessage.COLLECTION_NOT_FOUND)
  }

  invalidateCollectionsCache(userId)
  log.info({ userId, id, isFavorite: parsed.data.isFavorite }, 'Collection favorite toggled')
  return noContent()
})
