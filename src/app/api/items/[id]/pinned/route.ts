import { authedRouteWithParams, type IdParam } from '@/lib/api/route'
import { noContent, problem, parseOr422 } from '@/lib/api/http'
import { togglePinnedInput } from '@/lib/api/schemas/items'
import { ErrorMessage } from '@/lib/api/error-messages'
import { toggleItemPinned } from '@/lib/db/items'
import { invalidateItemsCache } from '@/lib/infra/cache'
import { logger } from '@/lib/infra/pino'

const log = logger.child({ tag: 'api-items' })

export const PATCH = authedRouteWithParams<IdParam>(
  { rateLimit: 'itemMutation' },
  async ({ userId, params, request }) => {
    const parsed = parseOr422(togglePinnedInput, await request.json())
    if (!parsed.ok) return parsed.res

    // toggleItemPinned scopes to userId and returns false when the row doesn't exist.
    if (!(await toggleItemPinned(userId, params.id, parsed.data.isPinned))) {
      return problem(404, ErrorMessage.ITEM_NOT_FOUND)
    }

    invalidateItemsCache(userId)
    log.info({ userId, id: params.id, isPinned: parsed.data.isPinned }, 'Item pinned toggled')
    return noContent()
  },
)
