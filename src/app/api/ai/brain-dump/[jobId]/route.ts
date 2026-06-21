import { authedRouteWithParams } from '@/lib/api/route'
import { json, noContent, problem, parseOr422 } from '@/lib/api/http'
import { brainDumpJobCollectionsInput } from '@/lib/api/schemas/ai'
import { getParseJobSnapshot, updateJobCollections, deleteJob } from '@/lib/db/ai-parse-jobs'
import { getOpenAIClient } from '@/lib/ai/openai'
import { logger } from '@/lib/infra/pino'

const log = logger.child({ tag: 'ai-brain-dump' })

interface JobIdParam {
  jobId: string
}

// JSON snapshot of a split job (status + progress + drafts). Used to resume/poll when SSE is
// unavailable. IDOR-scoped to the session user via the DB helper.
export const GET = authedRouteWithParams<JobIdParam>({}, async ({ userId, params }) => {
  const snapshot = await getParseJobSnapshot(userId, params.jobId)
  if (!snapshot) return problem(404, 'Parse job not found.')
  return json(snapshot)
})

// Update the job's commit-time collection target (new-collection name + existing collection ids).
// IDOR-scoped in the DB helper; spends no AI budget.
export const PATCH = authedRouteWithParams<JobIdParam>({}, async ({ userId, request, params }) => {
  const parsed = parseOr422(brainDumpJobCollectionsInput, await request.json())
  if (!parsed.ok) return parsed.res

  const updated = await updateJobCollections(userId, params.jobId, parsed.data)
  if (updated === 'not_found') return problem(404, 'Parse job not found.')
  if (updated === 'invalid_collections') return problem(422, 'One or more collections were not found.')
  return noContent()
})

// Discard a job: deletes the job + its drafts + `sourceText`, but **keeps the source item** (the FK is
// SetNull; the stash note/file is untouched). If the job was still processing, best-effort cancels the
// background OpenAI run (idempotent, background-only) so it stops generating. IDOR-scoped; no AI budget.
export const DELETE = authedRouteWithParams<JobIdParam>({}, async ({ userId, params }) => {
  const result = await deleteJob(userId, params.jobId)
  if (!result) return problem(404, 'Parse job not found.')

  if (result.openaiResponseId) {
    const client = getOpenAIClient()
    if (client) {
      try {
        await client.responses.cancel(result.openaiResponseId)
      } catch (err) {
        // Already finished/cancelled, or a transient error — the job is gone either way; don't fail the delete.
        log.warn({ userId, jobId: params.jobId, err }, 'best-effort cancel of background run failed on discard')
      }
    }
  }
  return noContent()
})
