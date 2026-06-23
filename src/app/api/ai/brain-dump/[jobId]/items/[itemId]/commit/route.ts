import { authedRouteWithParams } from '@/lib/api/route'
import { json, problem, parseOr422 } from '@/lib/api/http'
import { brainDumpItemCommitInput, brainDumpItemParams, type BrainDumpItemParams } from '@/lib/api/schemas/ai'
import { commitDraftItem } from '@/lib/db/ai-parse-jobs'
import { invalidateItemsCache, invalidateCollectionsCache } from '@/lib/infra/cache'
import { logger } from '@/lib/infra/pino'

const log = logger.child({ tag: 'ai-brain-dump-item-commit' })

// Per-item "Save now": commit a single draft into a real item — attached to the job's collection target
// (same union the batch commit uses) — then drop that draft. IDOR-scoped in the DB helper; spends no AI
// budget. The optional `confirmCreateCollection` gates materializing the job's pending new collection: the
// first POST (flag absent) returns `needsCollectionConfirm` so the client can prompt; a re-POST with true
// creates+attaches it, false commits with no new collection. `autoClosed` true → the last draft committed
// and the job became a closed history stub (the client redirects to the dashboard). Pro-gated.
export const POST = authedRouteWithParams<BrainDumpItemParams>({}, async ({ userId, isPro, request, params }) => {
  const parsedParams = parseOr422(brainDumpItemParams, params)
  if (!parsedParams.ok) return parsedParams.res
  if (!isPro) return problem(403, 'This feature requires a Pro subscription.')

  const { jobId, itemId } = parsedParams.data

  // Body is optional (empty POST = "ask first"): a missing/blank body is treated as `{}`, but a non-empty
  // malformed body falls through to 422 rather than being silently swallowed.
  const text = await request.text()
  let raw: unknown = {}
  if (text.trim()) {
    try {
      raw = JSON.parse(text)
    } catch {
      return problem(422, 'Request body must be valid JSON.')
    }
  }
  const parsed = parseOr422(brainDumpItemCommitInput, raw)
  if (!parsed.ok) return parsed.res

  const result = await commitDraftItem(userId, jobId, itemId, {
    confirmCreateCollection: parsed.data.confirmCreateCollection,
  })
  if (result === null) return problem(404, 'Draft item not found.')

  if (result.created > 0) {
    invalidateItemsCache(userId)
    // A commit may have created the job's new collection and attached existing ones — refresh both.
    invalidateCollectionsCache(userId)
    log.info(
      { userId, jobId, itemId, autoClosed: result.autoClosed },
      'brain-dump draft committed',
    )
  }
  return json({
    created: result.created,
    autoClosed: result.autoClosed,
    needsCollectionConfirm: result.needsCollectionConfirm,
  })
})
