import { ApiResponse, authenticatedRoute } from '@/lib/api'
import { getItemRemainFields } from '@/lib/db/items'
import type { RouteContext } from '@/lib/api'

export const GET = authenticatedRoute(async (_request, context: RouteContext, { userId }) => {
  const { id } = await context.params
  if (!id) return ApiResponse.BAD_REQUEST('Missing item ID.')

  const remainFields = await getItemRemainFields(userId, id)
  if (!remainFields) return ApiResponse.NOT_FOUND('Item not found.')

  return ApiResponse.OK(remainFields)
})
