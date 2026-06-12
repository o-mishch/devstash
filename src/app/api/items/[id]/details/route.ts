import { ApiResponse, authenticatedRoute } from '@/lib/api'
import { getItemDetails } from '@/lib/db/items'
import { createLogger } from '@/lib/infra/logger'
import type { RouteContext } from '@/lib/api'

const log = createLogger('api:item-details')

export const GET = authenticatedRoute(async (_request, context: RouteContext, { userId }) => {
  const { id } = await context.params
  if (!id) return ApiResponse.BAD_REQUEST('Missing item ID.')

  const start = Date.now()
  log.info('itemDetailsRequest', { userId, itemId: id })

  const details = await getItemDetails(userId, id)

  const duration = Date.now() - start
  if (!details) {
    log.warn('Item not found', { userId, itemId: id, duration })
    return ApiResponse.NOT_FOUND('Item not found.')
  }

  log.info('itemDetailsResponse', { userId, itemId: id, duration })
  return ApiResponse.OK(details)
})
