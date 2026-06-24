import { authedRouteWithParams } from '@/lib/api/route'
import { json, noContent, problem, parseOr422 } from '@/lib/api/http'
import { brainDumpItemPatchInput, brainDumpItemParams } from '@/lib/api/schemas/ai'
import { patchDraftItem, deleteDraftItem } from '@/lib/db/ai-parse-jobs'

type RouteParams = Awaited<RouteContext<'/api/ai/brain-dump/[jobId]/items/[itemId]'>['params']>

// Edit/reclassify (drag → bucket) or delete a single draft. Both are IDOR-scoped by the session user
// in the DB helper, so a draft from another user's job 404s. No AI budget is consumed here.
export const PATCH = authedRouteWithParams<RouteParams>({}, async ({ userId, request, params }) => {
  const parsedParams = parseOr422(brainDumpItemParams, params)
  if (!parsedParams.ok) return parsedParams.res
  const { jobId, itemId } = parsedParams.data

  const parsed = parseOr422(brainDumpItemPatchInput, await request.json())
  if (!parsed.ok) return parsed.res

  const updated = await patchDraftItem(userId, jobId, itemId, parsed.data)
  if (!updated) return problem(404, 'Draft item not found.')
  return json(updated)
})

export const DELETE = authedRouteWithParams<RouteParams>({}, async ({ userId, params }) => {
  const parsedParams = parseOr422(brainDumpItemParams, params)
  if (!parsedParams.ok) return parsedParams.res
  const { jobId, itemId } = parsedParams.data

  const removed = await deleteDraftItem(userId, jobId, itemId)
  if (!removed) return problem(404, 'Draft item not found.')
  return noContent()
})
