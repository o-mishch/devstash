'use server'

import { updateEditorPreferences } from '@/lib/db/profile'
import { invalidateProfileCache } from '@/lib/infra/cache'
import { createLogger } from '@/lib/infra/logger'
import type { EditorPreferences } from '@/types/editor-preferences'
import { ApiResponse } from '@/lib/api'
import type { ApiBody } from '@/types/api'
import { editorPreferencesSchema, parseOrFail } from '@/lib/utils/validators'
import { withAuthAndRateLimit } from '@/lib/session'

const logger = createLogger('settings')

export async function updateEditorPreferencesAction(
  preferences: EditorPreferences
): Promise<ApiBody<null>> {
  return withAuthAndRateLimit('updateSettings', async ({ userId }) => {
    const parsed = parseOrFail(editorPreferencesSchema, preferences)
    if (!parsed.success) return parsed.response

    await updateEditorPreferences(userId, parsed.data)
    await invalidateProfileCache(userId)
    logger.info('editor_preferences_updated', { userId })

    return ApiResponse.OK()
  })
}
