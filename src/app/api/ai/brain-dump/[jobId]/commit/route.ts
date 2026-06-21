import { authedRouteWithParams } from '@/lib/api/route'
import { json, problem } from '@/lib/api/http'
import { commitJob } from '@/lib/db/ai-parse-jobs'
import { invalidateItemsCache, invalidateCollectionsCache } from '@/lib/infra/cache'
import { logger } from '@/lib/infra/pino'

const log = logger.child({ tag: 'ai-brain-dump-commit' })

interface JobIdParam {
  jobId: string
}

// Commits every remaining draft into real items (via createItem), then deletes the job. Spends no AI
// budget. IDOR-scoped in the DB helper. After a successful commit the items cache is invalidated so
// the new items show up immediately. Pro-gated: the splitter is Pro-only, so a downgraded user can't
// materialize items from a previously-created job.
export const POST = authedRouteWithParams<JobIdParam>({}, async ({ userId, isPro, params }) => {
  if (!isPro) return problem(403, 'This feature requires a Pro subscription.')

  const result = await commitJob(userId, params.jobId)
  if (result.kind === 'not_found') return problem(404, 'Parse job not found.')
  if (result.kind === 'still_processing') {
    return problem(409, 'Wait for parsing to finish before saving all items.')
  }

  invalidateItemsCache(userId)
  // A commit may create a new collection and attach items to existing ones — refresh both caches.
  invalidateCollectionsCache(userId)
  log.info({ userId, jobId: params.jobId, created: result.created, total: result.total }, 'brain-dump job committed')
  return json({ created: result.created, total: result.total })
})
