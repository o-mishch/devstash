import { authedRouteWithParams } from '@/lib/api/route'
import { json, problem } from '@/lib/api/http'
import { commitDraftItem } from '@/lib/db/ai-parse-jobs'
import { invalidateItemsCache, invalidateCollectionsCache } from '@/lib/infra/cache'
import { logger } from '@/lib/infra/pino'

const log = logger.child({ tag: 'ai-brain-dump-item-commit' })

interface ItemParams {
  jobId: string
  itemId: string
}

// Per-item "Save now": commit a single draft into a real item — attached to the job's collection
// target (same union the batch commit uses) — then drop that draft. IDOR-scoped in the DB helper;
// spends no AI budget. A new collection named on the job is created once and reused by later saves.
// Pro-gated: the splitter is Pro-only, so a downgraded user can't materialize items from an old job.
export const POST = authedRouteWithParams<ItemParams>({}, async ({ userId, isPro, params }) => {
  if (!isPro) return problem(403, 'This feature requires a Pro subscription.')

  const created = await commitDraftItem(userId, params.jobId, params.itemId)
  if (created === null) return problem(404, 'Draft item not found.')
  if (created > 0) {
    invalidateItemsCache(userId)
    // A commit may have created the job's new collection and attached existing ones — refresh both.
    invalidateCollectionsCache(userId)
    log.info({ userId, jobId: params.jobId, itemId: params.itemId }, 'brain-dump draft committed')
  }
  return json({ created, total: 1 })
})
