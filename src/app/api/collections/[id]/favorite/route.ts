import { authedRouteWithParams, type IdParam } from '@/lib/api/route'
import { noContent, problem, parseOr422 } from '@/lib/api/http'
import { toggleFavoriteInput } from '@/lib/api/schemas/common'
import { ErrorMessage } from '@/lib/api/error-messages'
import { toggleCollectionFavorite } from '@/lib/db/collections'
import { invalidateCollectionsCache } from '@/lib/infra/cache'
import { logger } from '@/lib/infra/pino'

const log = logger.child({ tag: 'api-collections' })

export const PATCH = authedRouteWithParams<IdParam>({}, async ({ userId, params, request }) => {
  const parsed = parseOr422(toggleFavoriteInput, await request.json())
  if (!parsed.ok) return parsed.res

  // toggleCollectionFavorite scopes to userId and returns false when the row doesn't exist.
  if (!(await toggleCollectionFavorite(userId, params.id, parsed.data.isFavorite))) {
    return problem(404, ErrorMessage.COLLECTION_NOT_FOUND)
  }

  invalidateCollectionsCache(userId)
  log.info({ userId, id: params.id, isFavorite: parsed.data.isFavorite }, 'Collection favorite toggled')
  return noContent()
})
