import { ApiResponse, authenticatedRoute } from '@/lib/api'
import { getItemContent } from '@/lib/db/items'
import { createLogger } from '@/lib/infra/logger'
import type { RouteContext } from '@/lib/api'

const log = createLogger('api:item-content')

export const GET = authenticatedRoute(async (_request, context: RouteContext, { userId }) => {
  const { id } = await context.params
  if (!id) return ApiResponse.BAD_REQUEST('Missing item ID.')

  const start = Date.now()
  log.info('itemContentRequest', { userId, itemId: id })

  const content = await getItemContent(userId, id)

  const duration = Date.now() - start
  if (!content) {
    log.warn('Item content not found', { userId, itemId: id, duration })
    return ApiResponse.NOT_FOUND('Item not found.')
  }

  log.info('itemContentResponse', { userId, itemId: id, duration })
  return ApiResponse.OK(content)
})
