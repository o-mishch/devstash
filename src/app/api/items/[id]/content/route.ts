import { ApiResponse, authenticatedRoute } from '@/lib/api'
import { getItemContent } from '@/lib/db/items'
import { logger } from '@/lib/infra/pino'
import type { RouteContext } from '@/lib/api'

const log = logger.child({ tag: 'api:item-content' })

export const GET = authenticatedRoute(async (_request, context: RouteContext, { userId }) => {
  const { id } = await context.params
  if (!id) return ApiResponse.BAD_REQUEST('Missing item ID.')

  const start = Date.now()
  log.info({ userId, itemId: id }, 'itemContentRequest')

  const content = await getItemContent(userId, id)

  const duration = Date.now() - start
  if (!content) {
    log.warn({ userId, itemId: id, duration }, 'Item content not found')
    return ApiResponse.NOT_FOUND('Item not found.')
  }

  log.info({ userId, itemId: id, duration }, 'itemContentResponse')
  return ApiResponse.OK(content)
})
