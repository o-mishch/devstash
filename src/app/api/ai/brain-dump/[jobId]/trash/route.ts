import { authedRouteWithParams } from '@/lib/api/route'
import { noContent, problem, parseOr422 } from '@/lib/api/http'
import { brainDumpJobIdParam } from '@/lib/api/schemas/ai'
import { emptyJobTrash } from '@/lib/db/ai-parse-jobs'

type RouteParams = Awaited<RouteContext<'/api/ai/brain-dump/[jobId]/trash'>['params']>

// Empty the Trash bucket: permanently removes every trashed draft of a job. IDOR-scoped in the DB
// helper (404 for a job that isn't the user's), idempotent for an own job with empty trash, and spends
// no AI budget.
export const DELETE = authedRouteWithParams<RouteParams>({}, async ({ userId, params }) => {
  const parsedParams = parseOr422(brainDumpJobIdParam, params)
  if (!parsedParams.ok) return parsedParams.res
  const deleted = await emptyJobTrash(userId, parsedParams.data.jobId)
  if (deleted === null) return problem(404, 'Parse job not found.')
  return noContent()
})
