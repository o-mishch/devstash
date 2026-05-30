import { ApiResponse, authenticatedRoute } from '@/lib/api'
import { getItemById } from '@/lib/db/items'
import type { RouteContext } from '@/lib/api'

export const GET = authenticatedRoute(async (_request, context: RouteContext, userId) => {
  const { id } = await context.params
  if (!id) return ApiResponse.BAD_REQUEST('Missing item ID.')

  const item = await getItemById(userId, id)
  if (!item) return ApiResponse.NOT_FOUND('Item not found.')

  return ApiResponse.OK(item)
})
