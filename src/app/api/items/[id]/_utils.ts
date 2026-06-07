import { ApiResponse } from '@/lib/api'
import type { RouteContext } from '@/lib/api'

export async function validateItemId(context: RouteContext) {
  const { id } = await context.params
  if (!id) return { error: ApiResponse.BAD_REQUEST('Missing item ID.'), id: null }
  return { error: null, id }
}
