'use server'

import { updateEditorPreferences } from '@/lib/db/profile'
import { invalidateProfileCache } from '@/lib/cache'
import { createLogger } from '@/lib/logger'
import type { EditorPreferences } from '@/types/editor-preferences'
import { withRateLimit } from '@/lib/rate-limit'
import { ApiResponse } from '@/lib/api'
import type { ApiBody } from '@/types/api'
import { editorPreferencesSchema, parseOrFail } from '@/lib/utils/validators'
import { withAuth } from '@/lib/session'

const logger = createLogger('settings')

export async function updateEditorPreferencesAction(
  preferences: EditorPreferences
): Promise<ApiBody<null>> {
  return withRateLimit('updateSettings', async () => {
    return withAuth(async (userId) => {
      const parsed = parseOrFail(editorPreferencesSchema, preferences)
      if (!parsed.success) return parsed.response

      await updateEditorPreferences(userId, parsed.data)
      await invalidateProfileCache(userId)
      logger.info(`Editor preferences updated for user ${userId}`)
      
      return ApiResponse.OK()
    }, 'updateSettings')
  })
}
