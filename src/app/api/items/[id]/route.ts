import { apiRoute, ApiResponse } from '@/lib/api'
import { getCurrentUserId } from '@/lib/session'
import { getItemById } from '@/lib/db/items'

export const GET = apiRoute(async (_request, context) => {
  const userId = await getCurrentUserId()
  if (!userId) return ApiResponse.UNAUTHORIZED()

  const { id } = await context.params
  if (!id) return ApiResponse.BAD_REQUEST('Item ID is required')

  const item = await getItemById(userId, id)
  if (!item) return ApiResponse.NOT_FOUND('Item not found')

  return ApiResponse.OK(item)
})
