import { authedRouteWithParams } from '@/lib/api/route'
import { noContent, problem, parseOr422 } from '@/lib/api/http'
import { togglePinnedInput } from '@/lib/api/schemas/items'
import { idParam } from '@/lib/api/schemas/common'
import { ErrorMessage } from '@/lib/api/error-messages'
import { toggleItemPinned } from '@/lib/db/items'
import { invalidateItemsCache } from '@/lib/infra/cache'
import { logger } from '@/lib/infra/pino'

const log = logger.child({ tag: 'api-items' })

type RouteParams = Awaited<RouteContext<'/api/items/[id]/pinned'>['params']>

export const PATCH = authedRouteWithParams<RouteParams>(
  { rateLimit: 'itemMutation' },
  async ({ userId, params, request }) => {
    const parsedParams = parseOr422(idParam, params)
    if (!parsedParams.ok) return parsedParams.res
    const { id } = parsedParams.data

    const parsed = parseOr422(togglePinnedInput, await request.json())
    if (!parsed.ok) return parsed.res

    // toggleItemPinned scopes to userId and returns false when the row doesn't exist.
    if (!(await toggleItemPinned(userId, id, parsed.data.isPinned))) {
      return problem(404, ErrorMessage.ITEM_NOT_FOUND)
    }

    invalidateItemsCache(userId)
    log.info({ userId, id, isPinned: parsed.data.isPinned }, 'Item pinned toggled')
    return noContent()
  },
)
