import { ApiResponse, authenticatedRoute } from '@/lib/api'
import { getItemDetails } from '@/lib/db/items'
import { logger } from '@/lib/infra/pino'
import type { RouteContext } from '@/lib/api'

const log = logger.child({ tag: 'api:item-details' })

export const GET = authenticatedRoute(async (_request, context: RouteContext, { userId }) => {
  const { id } = await context.params
  if (!id) return ApiResponse.BAD_REQUEST('Missing item ID.')

  const start = Date.now()
  log.info({ userId, itemId: id }, 'itemDetailsRequest')

  const details = await getItemDetails(userId, id)

  const duration = Date.now() - start
  if (!details) {
    log.warn({ userId, itemId: id, duration }, 'Item not found')
    return ApiResponse.NOT_FOUND('Item not found.')
  }

  log.info({ userId, itemId: id, duration }, 'itemDetailsResponse')
  return ApiResponse.OK(details)
})
