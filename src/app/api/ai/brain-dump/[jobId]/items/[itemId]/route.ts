import { authedRouteWithParams } from '@/lib/api/route'
import { json, noContent, problem, parseOr422 } from '@/lib/api/http'
import { brainDumpItemPatchInput } from '@/lib/api/schemas/ai'
import { patchDraftItem, deleteDraftItem } from '@/lib/db/ai-parse-jobs'

interface ItemParams {
  jobId: string
  itemId: string
}

// Edit/reclassify (drag → bucket) or delete a single draft. Both are IDOR-scoped by the session user
// in the DB helper, so a draft from another user's job 404s. No AI budget is consumed here.
export const PATCH = authedRouteWithParams<ItemParams>({}, async ({ userId, request, params }) => {
  const parsed = parseOr422(brainDumpItemPatchInput, await request.json())
  if (!parsed.ok) return parsed.res

  const updated = await patchDraftItem(userId, params.jobId, params.itemId, parsed.data)
  if (!updated) return problem(404, 'Draft item not found.')
  return json(updated)
})

export const DELETE = authedRouteWithParams<ItemParams>({}, async ({ userId, params }) => {
  const removed = await deleteDraftItem(userId, params.jobId, params.itemId)
  if (!removed) return problem(404, 'Draft item not found.')
  return noContent()
})
