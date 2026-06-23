import { after } from 'next/server'
import { authedRoute, rateLimited } from '@/lib/api/route'
import { json, problem, parseOr422 } from '@/lib/api/http'
import { brainDumpInput, brainDumpListQuery } from '@/lib/api/schemas/ai'
import { checkRateLimit, resetRateLimit } from '@/lib/infra/rate-limit'
import {
  createParseJob,
  listActiveParseJobs,
  listClosedParseJobs,
  getSourceItemForParse,
  getSourceText,
  sweepAbandonedParseJobs,
  type ParseSourceItem,
} from '@/lib/db/ai-parse-jobs'
import { createItem, deleteItem } from '@/lib/db/items'
import { invalidateItemsCache } from '@/lib/infra/cache'
import { BRAIN_DUMP_SOURCE_TAG, SPLIT_FILE_MIN_INPUT_CHARS } from '@/lib/utils/constants'
import { deriveBrainDumpNoteTitle, deriveCollectionName } from '@/lib/utils/derive-source-label'
import { logger } from '@/lib/infra/pino'

const log = logger.child({ tag: 'ai-brain-dump' })

// Lists the user's split jobs: the active list (in-progress + committable completed/failed) by default,
// or the closed History list with `?history=1`. No AI budget consumed. Opportunistically sweeps abandoned
// (24 h-stale) jobs after responding — the lazy-cleanup backstop (no cron); best-effort, so a sweep
// failure never affects the listing.
export const GET = authedRoute({}, async ({ userId, request }) => {
  const parsed = parseOr422(brainDumpListQuery, Object.fromEntries(request.nextUrl.searchParams))
  if (!parsed.ok) return parsed.res
  const jobs = parsed.data.history ? await listClosedParseJobs(userId) : await listActiveParseJobs(userId)
  after(sweepAbandonedParseJobs)
  return json({ jobs })
})

// Starts a "Brain Dump" split. **Gate-first:** validate (422) → Pro (403) → 1/hr budget (429) BEFORE
// persisting any source item or job, so a refused request never orphans a note (paste) and never spends
// the token. Then v1 source persistence: a **paste** (`text`) is stored whole as a `brain-dump` `note`
// and its 50k parse window sliced in memory; an **upload/select** (`sourceItemId`) reuses an existing
// `file`/`note` item after server-side ownership + text-eligibility re-validation (bounded S3 range
// read). The actual OpenAI streaming runs in GET …/[jobId]/stream. `userId` is from the session (IDOR-safe).
export const POST = authedRoute({}, async ({ userId, isPro, request }) => {
  const parsed = parseOr422(brainDumpInput, await request.json())
  if (!parsed.ok) return parsed.res

  if (!isPro) return problem(403, 'This feature requires a Pro subscription.')

  const { text, sourceItemId } = parsed.data

  // Resolve an existing source BEFORE spending the token: an unreadable/ineligible source 422s with no
  // token consumed and no job created. (Paste text is already validated by the schema; its note is
  // created only after the rate-limit gate below, so a refused paste never orphans a note.)
  let resolvedRead: { text: string; truncated: boolean; sourceName: string | null } | null = null
  let resolvedSourceItemId: string | null = null
  if (sourceItemId) {
    const item = await getSourceItemForParse(userId, sourceItemId)
    if (!item) return problem(404, 'Source item not found.')
    try {
      resolvedRead = await getSourceText(item)
    } catch (err) {
      log.warn({ userId, sourceItemId, err }, 'source item not readable as text')
      return problem(422, 'That item can’t be parsed as text. Choose a .txt or .md file source.')
    }
    if (resolvedRead.text.replace(/\s/g, '').length < SPLIT_FILE_MIN_INPUT_CHARS) {
      return problem(422, `That source has too little text to split (at least ${SPLIT_FILE_MIN_INPUT_CHARS} characters).`)
    }
    resolvedSourceItemId = item.id
  }

  // Gate the hourly budget BEFORE creating any source item or job (no orphan note, no spent token on a
  // refused request).
  const { success, retryAfter } = await checkRateLimit('aiBrainDump', userId)
  if (!success) return rateLimited(retryAfter)

  let sourceText: string
  let truncated: boolean
  let sourceName: string | null
  // The paste note we created in this request (if any) — deleted if the job create then fails, so a
  // refused job never orphans a brain-dump note. Never set for a reused existing source item.
  let createdNoteId: string | null = null

  // The default new-collection name seeded on the job. For a paste it is exactly the note title; for an
  // existing file/note source it is derived from the source name (trailing extension dropped).
  let collectionName: string | null

  if (resolvedRead && resolvedSourceItemId) {
    sourceText = resolvedRead.text
    truncated = resolvedRead.truncated
    sourceName = resolvedRead.sourceName
    collectionName = deriveCollectionName(sourceName)
  } else {
    // Paste — persist the FULL text as a durable `brain-dump` note (the existing createItem way), then
    // slice the parse window in memory (no re-read, no second transfer). A paste has no intrinsic name,
    // so the saved note gets a dated "Brain dump <date>" label, while the new-collection name is left
    // empty (the user names the collection themselves on the review board).
    const fullText = text ?? ''
    const noteTitle = deriveBrainDumpNoteTitle()
    const note = await createItem(userId, {
      title: noteTitle,
      description: null,
      content: fullText,
      url: null,
      fileUrl: null,
      fileName: null,
      fileSize: null,
      language: null,
      tags: [BRAIN_DUMP_SOURCE_TAG],
      itemTypeName: 'note',
      collectionIds: [],
    })
    if (!note) return problem(500, 'Could not save your pasted text.')
    invalidateItemsCache(userId)

    const noteSource: ParseSourceItem = {
      id: note.id,
      itemTypeName: 'note',
      content: fullText,
      fileUrl: null,
      fileName: null,
    }
    const read = await getSourceText(noteSource)
    sourceText = read.text
    truncated = read.truncated
    sourceName = read.sourceName ?? noteTitle
    // The new-collection input starts empty for a paste — the user names the target collection on the
    // review board rather than defaulting it to the dated note title.
    collectionName = null
    resolvedSourceItemId = note.id
    createdNoteId = note.id
  }

  let jobId: string
  try {
    jobId = await createParseJob(userId, {
      sourceText,
      sourceItemId: resolvedSourceItemId,
      sourceName,
      truncated,
      collectionName,
    })
  } catch (err) {
    // Job creation failed after the paste note was persisted — remove the orphan note and refund the
    // hourly token so a transient DB error doesn't burn the user's 1/hr Brain Dump quota.
    await resetRateLimit('aiBrainDump', userId)
    if (createdNoteId) {
      await deleteItem(userId, createdNoteId)
      invalidateItemsCache(userId)
    }
    log.error({ userId, sourceItemId: resolvedSourceItemId, err }, 'brain-dump job create failed')
    return problem(500, 'Could not start your Brain Dump. Please try again.')
  }
  log.info({ userId, jobId, truncated }, 'brain-dump job started')
  // Lazy abandoned-job cleanup backstop (no cron) — best-effort, after the response.
  after(sweepAbandonedParseJobs)
  return json({ jobId, sourceName, truncated }, 201)
})
