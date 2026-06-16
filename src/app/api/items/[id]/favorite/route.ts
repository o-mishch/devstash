import { authedRouteWithParams, type IdParam } from '@/lib/api/route'
import { noContent, problem, parseOr422 } from '@/lib/api/http'
import { toggleFavoriteInput } from '@/lib/api/schemas/common'
import { ErrorMessage } from '@/lib/api/error-messages'
import { toggleItemFavorite } from '@/lib/db/items'
import { invalidateItemsCache } from '@/lib/infra/cache'
import { logger } from '@/lib/infra/pino'

const log = logger.child({ tag: 'api-items' })

export const PATCH = authedRouteWithParams<IdParam>(
  { rateLimit: 'itemMutation' },
  async ({ userId, params, request }) => {
    const parsed = parseOr422(toggleFavoriteInput, await request.json())
    if (!parsed.ok) return parsed.res

    // toggleItemFavorite scopes to userId and returns false when the row doesn't exist.
    if (!(await toggleItemFavorite(userId, params.id, parsed.data.isFavorite))) {
      return problem(404, ErrorMessage.ITEM_NOT_FOUND)
    }

    invalidateItemsCache(userId)
    log.info({ userId, id: params.id, isFavorite: parsed.data.isFavorite }, 'Item favorite toggled')
    return noContent()
  },
)
