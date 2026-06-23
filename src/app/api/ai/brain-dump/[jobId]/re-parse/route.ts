import { after } from 'next/server'
import { authedRouteWithParams, rateLimited } from '@/lib/api/route'
import { json, parseOr422, problem } from '@/lib/api/http'
import { brainDumpJobIdParam, type BrainDumpJobIdParam } from '@/lib/api/schemas/ai'
import { checkRateLimit, resetRateLimit } from '@/lib/infra/rate-limit'
import {
  createParseJob,
  getReparseEligibility,
  getSourceItemForParse,
  getSourceText,
  sweepAbandonedParseJobs,
} from '@/lib/db/ai-parse-jobs'
import { SPLIT_FILE_MIN_INPUT_CHARS } from '@/lib/utils/constants'
import { deriveCollectionName } from '@/lib/utils/derive-source-label'
import { logger } from '@/lib/infra/pino'

const log = logger.child({ tag: 'ai-brain-dump-re-parse' })

// Re-parse takes no request body — the source is re-read from the original job's durable item.
export const POST = authedRouteWithParams<BrainDumpJobIdParam>({}, async ({ userId, isPro, params }) => {
  const parsedParams = parseOr422(brainDumpJobIdParam, params)
  if (!parsedParams.ok) return parsedParams.res
  if (!isPro) return problem(403, 'This feature requires a Pro subscription.')

  const { jobId: originalJobId } = parsedParams.data
  // Re-parse is `completed`-only: a `processing` job is still streaming; a `failed`/`closed` job uses the
  // status-independent parse-from-stash on the source item instead (it's the retry path for those).
  const eligibility = await getReparseEligibility(userId, originalJobId)
  if (!eligibility) return problem(404, 'The original parse job was not found.')
  if (eligibility.status !== 'completed') {
    return problem(409, 'Only a completed parse job can be re-parsed. Use “Parse with Brain Dump” on the source item instead.')
  }
  const sourceItemId = eligibility.sourceItemId
  if (!sourceItemId) return problem(404, 'The original parse job or its source was not found.')

  const source = await getSourceItemForParse(userId, sourceItemId)
  if (!source) return problem(404, 'The source item is no longer available.')

  let read: Awaited<ReturnType<typeof getSourceText>>
  try {
    read = await getSourceText(source)
  } catch (err) {
    log.warn({ userId, jobId: originalJobId, sourceItemId, err }, 're-parse source not readable as text')
    return problem(422, "That source can't be parsed as text. Choose a .txt or .md file source.")
  }
  if (read.text.replace(/\s/g, '').length < SPLIT_FILE_MIN_INPUT_CHARS) {
    return problem(422, `That source has too little text to split (at least ${SPLIT_FILE_MIN_INPUT_CHARS} characters).`)
  }

  const { success, retryAfter } = await checkRateLimit('aiBrainDump', userId)
  if (!success) return rateLimited(retryAfter)

  try {
    const jobId = await createParseJob(userId, {
      sourceText: read.text,
      sourceItemId,
      sourceName: read.sourceName,
      truncated: read.truncated,
      collectionName: deriveCollectionName(read.sourceName),
    })
    log.info({ userId, jobId, sourceItemId, truncated: read.truncated }, 'brain-dump re-parse started')
    // Lazy abandoned-job cleanup backstop (no cron) — re-parse is a create handler too, so it registers
    // the same after()-sweep as POST/GET /brain-dump.
    after(sweepAbandonedParseJobs)
    return json({ jobId, sourceName: read.sourceName, truncated: read.truncated }, 201)
  } catch (err) {
    await resetRateLimit('aiBrainDump', userId)
    log.error({ userId, sourceItemId, err }, 'brain-dump re-parse job create failed')
    return problem(500, 'Could not re-parse your source. Please try again.')
  }
})
