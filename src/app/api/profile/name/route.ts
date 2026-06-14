import 'server-only'
import { z } from 'zod'
import { authenticatedRoute, ApiResponse } from '@/lib/api'
import { parseOrFail, NameSchema } from '@/lib/utils/validators'
import { rateLimitRoute } from '@/lib/infra/rate-limit'
import { updateUserName } from '@/lib/db/profile'
import { invalidateProfileCache } from '@/lib/infra/cache'

const updateNameSchema = z.object({ name: NameSchema })

export const PATCH = authenticatedRoute(async (request, _context, { userId }) => {
  const denied = await rateLimitRoute('updateSettings', userId)
  if (denied) return denied

  const body: unknown = await request.json()
  const parsed = parseOrFail(updateNameSchema, body)
  if (!parsed.success) return parsed.response

  await updateUserName(userId, parsed.data.name)
  invalidateProfileCache(userId)
  return ApiResponse.OK()
})
