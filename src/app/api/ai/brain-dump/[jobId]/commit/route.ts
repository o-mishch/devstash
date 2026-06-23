import { authedRouteWithParams } from '@/lib/api/route'
import { json, problem, parseOr422 } from '@/lib/api/http'
import { brainDumpJobIdParam, type BrainDumpJobIdParam } from '@/lib/api/schemas/ai'
import { commitJob } from '@/lib/db/ai-parse-jobs'
import { invalidateItemsCache, invalidateCollectionsCache } from '@/lib/infra/cache'
import { logger } from '@/lib/infra/pino'

const log = logger.child({ tag: 'ai-brain-dump-commit' })

// Commits every remaining (non-trashed) draft into real items, then — when all saved — demotes the job
// to the `closed` history stub (v2.5: not a delete; the trash bucket is kept). Spends no AI budget.
// IDOR-scoped in the DB helper. After a successful commit the items cache is invalidated so the new items
// show up immediately. `closed` true → the client toasts + redirects to the dashboard. Pro-gated: the
// splitter is Pro-only, so a downgraded user can't materialize items from a previously-created job.
export const POST = authedRouteWithParams<BrainDumpJobIdParam>({}, async ({ userId, isPro, params }) => {
  const parsedParams = parseOr422(brainDumpJobIdParam, params)
  if (!parsedParams.ok) return parsedParams.res
  if (!isPro) return problem(403, 'This feature requires a Pro subscription.')

  const { jobId } = parsedParams.data
  const result = await commitJob(userId, jobId)
  if (result.kind === 'not_found') return problem(404, 'Parse job not found.')
  if (result.kind === 'still_processing') {
    return problem(409, 'Wait for parsing to finish before saving all items.')
  }

  invalidateItemsCache(userId)
  // A commit may create a new collection and attach items to existing ones — refresh both caches.
  invalidateCollectionsCache(userId)
  log.info(
    { userId, jobId, created: result.created, total: result.total, closed: result.closed },
    'brain-dump job committed',
  )
  return json({ created: result.created, total: result.total, closed: result.closed })
})
