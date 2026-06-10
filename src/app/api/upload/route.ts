import { ApiResponse, authenticatedRoute } from '@/lib/api'
import { deleteStoredImageFiles } from '@/lib/storage/image-thumbnails'

export const DELETE = authenticatedRoute(async (request, _context, { userId }) => {
  const { searchParams } = new URL(request.url)
  const key = searchParams.get('key')

  if (!key) return ApiResponse.BAD_REQUEST('Missing key.')

  // Only allow deleting keys that belong to this user
  if (!key.startsWith(`${userId}/`)) return ApiResponse.FORBIDDEN('Access denied.')

  await deleteStoredImageFiles(key)

  return ApiResponse.OK()
})
