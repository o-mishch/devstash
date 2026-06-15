import 'server-only'
import { z } from 'zod'
import { authenticatedRoute, ApiResponse } from '@/lib/api'
import { parseOrFail } from '@/lib/utils/validators'
import type { Logger } from 'pino'

interface ToggleRouteConfig {
  /** Body field carrying the new boolean value (also used as the log data key). */
  flagKey: 'isFavorite' | 'isPinned'
  /** DB toggle scoped to the session user; resolves `false` when the row is missing. */
  toggle: (userId: string, id: string, value: boolean) => Promise<boolean>
  invalidate: (userId: string) => void
  notFoundMessage: string
  log: Logger
  logHeadline: string
}

/**
 * Builds a PATCH handler for a boolean toggle on a user-owned resource: validate
 * `{ [flagKey]: boolean }`, toggle (scoped to the session userId), 404 when the row
 * is missing, invalidate the cache, log, and return OK.
 */
export function toggleRoute({ flagKey, toggle, invalidate, notFoundMessage, log, logHeadline }: ToggleRouteConfig) {
  const schema = z.object({ [flagKey]: z.boolean() })

  return authenticatedRoute(async (request, context, { userId }) => {
    const { id } = await context.params
    const body: unknown = await request.json()
    const parsed = parseOrFail(schema, body)
    if (!parsed.success) return parsed.response

    const value = parsed.data[flagKey]
    const ok = await toggle(userId, id, value)
    if (!ok) return ApiResponse.NOT_FOUND(notFoundMessage)

    invalidate(userId)
    log.info({ userId, id, [flagKey]: value }, logHeadline)
    return ApiResponse.OK()
  })
}
