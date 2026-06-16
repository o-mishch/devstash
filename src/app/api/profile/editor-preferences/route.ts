import { authedRoute } from '@/lib/api/route'
import { noContent, parseOr422 } from '@/lib/api/http'
import { editorPreferencesInput } from '@/lib/api/schemas/profile'
import { updateEditorPreferences } from '@/lib/db/profile'
import { invalidateProfileCache } from '@/lib/infra/cache'

export const PATCH = authedRoute({ rateLimit: 'updateSettings' }, async ({ userId, request }) => {
  const parsed = parseOr422(editorPreferencesInput, await request.json())
  if (!parsed.ok) return parsed.res

  await updateEditorPreferences(userId, parsed.data)
  invalidateProfileCache(userId)
  return noContent()
})
