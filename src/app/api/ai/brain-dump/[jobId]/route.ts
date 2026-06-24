import { authedRouteWithParams } from '@/lib/api/route'
import { json, noContent, problem, parseOr422 } from '@/lib/api/http'
import { brainDumpJobCollectionsInput, brainDumpJobIdParam } from '@/lib/api/schemas/ai'
import { getParseJobSnapshot, updateJobCollections, deleteJob } from '@/lib/db/ai-parse-jobs'
import { getOpenAIClient } from '@/lib/ai/openai'
import { logger } from '@/lib/infra/pino'

const log = logger.child({ tag: 'ai-brain-dump' })

type RouteParams = Awaited<RouteContext<'/api/ai/brain-dump/[jobId]'>['params']>

// JSON snapshot of a split job (status + progress + drafts). Used to resume/poll when SSE is
// unavailable. IDOR-scoped to the session user via the DB helper.
export const GET = authedRouteWithParams<RouteParams>({}, async ({ userId, params }) => {
  const parsedParams = parseOr422(brainDumpJobIdParam, params)
  if (!parsedParams.ok) return parsedParams.res
  const { jobId } = parsedParams.data

  const snapshot = await getParseJobSnapshot(userId, jobId)
  if (!snapshot) return problem(404, 'Parse job not found.')
  return json(snapshot)
})

// Update the job's commit-time collection target (new-collection name + existing collection ids).
// IDOR-scoped in the DB helper; spends no AI budget.
export const PATCH = authedRouteWithParams<RouteParams>({}, async ({ userId, request, params }) => {
  const parsedParams = parseOr422(brainDumpJobIdParam, params)
  if (!parsedParams.ok) return parsedParams.res
  const { jobId } = parsedParams.data

  const parsed = parseOr422(brainDumpJobCollectionsInput, await request.json())
  if (!parsed.ok) return parsed.res

  const updated = await updateJobCollections(userId, jobId, parsed.data)
  if (updated === 'not_found') return problem(404, 'Parse job not found.')
  if (updated === 'invalid_collections') return problem(422, 'One or more collections were not found.')
  return noContent()
})

// Discard a job: deletes the job + its drafts + `sourceText`, but **keeps the source item** (the FK is
// SetNull; the stash note/file is untouched). If the job was still processing, best-effort cancels the
// background OpenAI run (idempotent, background-only) so it stops generating. IDOR-scoped; no AI budget.
export const DELETE = authedRouteWithParams<RouteParams>({}, async ({ userId, params }) => {
  const parsedParams = parseOr422(brainDumpJobIdParam, params)
  if (!parsedParams.ok) return parsedParams.res
  const { jobId } = parsedParams.data

  const result = await deleteJob(userId, jobId)
  if (!result) return problem(404, 'Parse job not found.')

  if (result.openaiResponseId) {
    const client = getOpenAIClient()
    if (client) {
      try {
        await client.responses.cancel(result.openaiResponseId)
      } catch (err) {
        // Already finished/cancelled, or a transient error — the job is gone either way; don't fail the delete.
        log.warn({ userId, jobId, err }, 'best-effort cancel of background run failed on discard')
      }
    }
  }
  return noContent()
})
