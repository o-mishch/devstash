import { authedRouteWithParams } from '@/lib/api/route'
import { noContent, problem } from '@/lib/api/http'
import { emptyJobTrash } from '@/lib/db/ai-parse-jobs'

interface JobIdParam {
  jobId: string
}

// Empty the Trash bucket: permanently removes every trashed draft of a job. IDOR-scoped in the DB
// helper (404 for a job that isn't the user's), idempotent for an own job with empty trash, and spends
// no AI budget.
export const DELETE = authedRouteWithParams<JobIdParam>({}, async ({ userId, params }) => {
  const deleted = await emptyJobTrash(userId, params.jobId)
  if (deleted === null) return problem(404, 'Parse job not found.')
  return noContent()
})
