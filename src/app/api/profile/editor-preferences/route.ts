import 'server-only'
import { authenticatedRoute, ApiResponse } from '@/lib/api'
import { parseOrFail, editorPreferencesSchema } from '@/lib/utils/validators'
import { rateLimitRoute } from '@/lib/infra/rate-limit'
import { updateEditorPreferences } from '@/lib/db/profile'
import { invalidateProfileCache } from '@/lib/infra/cache'

export const PATCH = authenticatedRoute(async (request, _context, { userId }) => {
  const denied = await rateLimitRoute('updateSettings', userId)
  if (denied) return denied

  const body: unknown = await request.json()
  const parsed = parseOrFail(editorPreferencesSchema, body)
  if (!parsed.success) return parsed.response

  await updateEditorPreferences(userId, parsed.data)
  invalidateProfileCache(userId)
  return ApiResponse.OK()
})
