import { ApiResponse, authenticatedRoute } from '@/lib/api'
import { getItemDetails } from '@/lib/db/items'
import { validateItemId } from '../_utils'
import type { RouteContext } from '@/lib/api'

export const GET = authenticatedRoute(async (_request, context: RouteContext, { userId }) => {
  const { id, error } = await validateItemId(context)
  if (error) return error

  const details = await getItemDetails(userId, id)
  if (!details) return ApiResponse.NOT_FOUND('Item not found.')

  return ApiResponse.OK(details)
})
