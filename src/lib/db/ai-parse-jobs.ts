import 'server-only'
import { Prisma } from '@/generated/prisma/client'
import { prisma } from '@/lib/infra/prisma'
import { getRedis } from '@/lib/infra/redis'
import { logger } from '@/lib/infra/pino'
import { createItem, type CreateItemInput } from '@/lib/db/items'
import { getTextFromS3 } from '@/lib/storage/s3'
import {
  COLLECTION_NAME_MAX_CHARS,
  SPLIT_FILE_MAX_INPUT_CHARS,
  SPLIT_FILE_ALLOWED_EXTS,
  ITEM_TYPES_WITH_CONTENT,
  ITEM_TYPES_WITH_LANGUAGE,
  PARSE_JOB_TTL_MS,
  BRAIN_DUMP_SOURCE_TAG,
} from '@/lib/utils/constants'
import { brainDumpProgress, type BrainDumpDraft, type BrainDumpFailureReason } from '@/lib/ai/brain-dump'
import { findDuplicateMatches, type DuplicateMatch } from '@/lib/db/parse-dedup'

// Data access for the AI File Splitter staging tables (`AiParseJob` + `AiParseJobItem`). These are
// short-lived draft/staging rows: a job is created on upload, items are appended live as the model
// streams, the user edits/reclassifies them, and the whole job is deleted on commit. Every read is
// per-user and live, so none of these helpers use `'use cache'` — a cached snapshot would defeat the
// stream/refresh-resume flow and serve stale drafts the moment the user edits one.

const log = logger.child({ tag: 'ai-parse-jobs' })

// v2.5 status model: `processing` (also the resumable interrupted state), `completed` (in review),
// `failed` (not-resumable, rich detail), `closed` (post-commit history stub — terminal, never resumed
// or re-parsed). See note 7 in the feature doc.
export type ParseJobStatus = 'processing' | 'completed' | 'failed' | 'closed'

// Per-type commit tally stamped onto a closed job ({ snippet: 3, note: 2 }). Stored in the
// `committedByType Json?` column; merged additively on each late trash-bucket commit.
export type CommittedByType = Record<string, number>

// Coerces the `committedByType` Json column to a plain `{ type: count }` record. Only this module ever
// writes the column (always as an object), but the Prisma `Json` type is `unknown`-shaped — a defensive
// guard keeps a stray array/scalar from corrupting the tally instead of trusting an `as` cast.
function asCommittedByType(value: Prisma.JsonValue | null): CommittedByType {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
  return value as CommittedByType
}

// Sums a list of committed draft types into a per-type tally, folded onto an existing base tally (the
// running `committedByType` map) so late trash-commits accumulate rather than overwrite.
function tallyByType(base: CommittedByType, types: string[]): CommittedByType {
  const next: CommittedByType = { ...base }
  types.forEach((type) => {
    next[type] = (next[type] ?? 0) + 1
  })
  return next
}

// Read-merge-write the running stub stats (`committedCount` + `committedByType`) onto the job matched by
// `where`, in one atomic step so the scalar and the map can't drift (note 7). `extraData` carries any
// other fields written in the SAME update (e.g. the close demote: `status`/`sourceText`). The single
// `where`-scoped `findFirst`→`updateMany` is the shared body behind every stats path: per-item commit
// bump, "Save all" close, self-heal close, and late closed-job trash-commit merge.
//
// Concurrency: the bulk save-now fan-out fires several per-item commits at this same row at once. The map
// is an unavoidable read-modify-write, so the whole bump runs under `Serializable` with a P2034 retry —
// without it (Postgres' Read Committed default) two concurrent bumps both read the same base and write
// base+1, losing an increment. `committedCount` additionally uses atomic `increment` so the scalar is
// always exact even before the serialization guard kicks in. Returns the new total (so callers can confirm
// the row was matched), or null when nothing matched `where`.
async function bumpCommittedStats(
  where: Prisma.AiParseJobWhereInput,
  types: string[],
  extraData: Prisma.AiParseJobUpdateManyMutationInput = {},
): Promise<number | null> {
  const MAX_RETRIES = 5
  let retries = 0
  for (;;) {
    try {
      return await prisma.$transaction(
        async (tx) => {
          const job = await tx.aiParseJob.findFirst({
            where,
            select: { committedCount: true, committedByType: true },
          })
          if (!job) return null
          // With no committed types there's no per-type tally to merge — write only `extraData` (e.g. the
          // close demote's status/sourceText). Keeping the map out of the write set avoids a redundant
          // rewrite that would widen the conflict window against a concurrent late increment.
          const data: Prisma.AiParseJobUpdateManyMutationInput = { ...extraData }
          if (types.length > 0) {
            data.committedCount = { increment: types.length }
            data.committedByType = tallyByType(asCommittedByType(job.committedByType), types)
          }
          await tx.aiParseJob.updateMany({ where, data })
          return job.committedCount + types.length
        },
        { isolationLevel: 'Serializable' },
      )
    } catch (error) {
      // P2034 = serialization conflict; retry a bounded number of times, then surface to the caller. The
      // bulk save-now fan-out aims several bumps at this one row, so back off with a little jitter before
      // retrying — an immediate tight retry against a hot row just thrashes the same conflict.
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2034' && ++retries < MAX_RETRIES) {
        await new Promise((resolve) => setTimeout(resolve, retries * 15 + Math.floor(Math.random() * 15)))
        continue
      }
      throw error
    }
  }
}

// Records the just-committed types onto an IN-REVIEW job's running tally as each per-item "Save now"
// lands, so a job committed draft-by-draft carries an accurate total by the time it closes (instead of
// only the final draft being counted). Scoped to `status != 'closed'` so it never touches a history stub.
async function recordInReviewCommit(userId: string, jobId: string, types: string[]): Promise<void> {
  if (types.length === 0) return
  await bumpCommittedStats({ id: jobId, userId, status: { not: 'closed' } }, types)
}

// Browser-facing draft shape (matches `splitDraftItemSchema`). `order` drives board ordering.
export interface ParseDraftItemDTO {
  id: string
  order: number
  itemTypeName: string
  title: string
  content: string | null
  url: string | null
  language: string | null
  description: string | null
  tags: string[]
  trashed: boolean
  // Advisory de-dup: the committed stash item this draft appears to duplicate (id for the deep-link,
  // title for the badge), or null/absent when it's unique. Set only on the snapshot read (board seed);
  // never persisted, never blocks commit.
  duplicateOf?: DuplicateMatch | null
}

export interface ParseJobSnapshot {
  status: ParseJobStatus
  progress: number
  error: string | null
  // Collection target applied at commit (new collection name + selected existing collection ids).
  collectionName: string | null
  collectionIds: string[]
  // v1 source persistence: the durable source item this job was parsed from. `sourceItemId`/
  // `sourceItemType` are null if the user has since deleted that item (onDelete: SetNull); `sourceName`
  // is the display label; `truncated` flags that the parse window was boundary-cut (the stored source
  // is always full). The review header uses these for the source deep-link + truncation notice.
  sourceItemId: string | null
  sourceItemType: string | null
  sourceName: string | null
  truncated: boolean
  // Closed-job history stub stats (0/null until the job is closed).
  committedCount: number
  committedByType: CommittedByType | null
  items: ParseDraftItemDTO[]
}

// Everything the stream route needs to decide fresh-start vs. resume vs. attach.
export interface ParseJobRunState {
  status: ParseJobStatus
  sourceText: string
  openaiResponseId: string | null
  streamCursor: number | null
  itemCount: number
}

// One row in the in-progress list (entry-card badge + /parse index) or the History list. For a closed
// (history) row, `committedCount`/`committedByType` carry the stub stats and `itemCount` is the leftover
// trash count.
export interface ParseJobSummary {
  id: string
  status: ParseJobStatus
  progress: number
  itemCount: number
  sourceName: string | null
  // The job's commit-time "New collection" name (defaults to the source filename); the list card labels
  // the row with this over `sourceName` so it matches the collection the saved items will join.
  collectionName: string | null
  createdAt: string
  committedCount?: number
  committedByType?: CommittedByType | null
}

const DRAFT_SELECT = {
  id: true,
  order: true,
  itemTypeName: true,
  title: true,
  content: true,
  url: true,
  language: true,
  description: true,
  tags: true,
  trashed: true,
} satisfies Prisma.AiParseJobItemSelect

export interface CreateParseJobInput {
  // The boundary-truncated parse window (≤ SPLIT_FILE_MAX_INPUT_CHARS) fed to OpenAI.
  sourceText: string
  // The durable source stash item (note for paste, file for upload/select); always set at creation.
  sourceItemId: string
  // Display label for the source (note title / file name) + whether the parse window was truncated.
  sourceName: string | null
  truncated: boolean
  // Seeds the default "new collection" name (from the source name); blank → no default.
  collectionName?: string | null
}

export async function createParseJob(userId: string, input: CreateParseJobInput): Promise<string> {
  const seededName = input.collectionName?.trim().slice(0, COLLECTION_NAME_MAX_CHARS) || null
  const job = await prisma.aiParseJob.create({
    data: {
      userId,
      sourceText: input.sourceText,
      sourceItemId: input.sourceItemId,
      sourceName: input.sourceName,
      truncated: input.truncated,
      status: 'processing',
      progress: 0,
      collectionName: seededName,
    },
    select: { id: true },
  })
  log.info(
    { userId, jobId: job.id, chars: input.sourceText.length, sourceItemId: input.sourceItemId, truncated: input.truncated },
    'parse job created',
  )
  return job.id
}

/** Returns the durable source id for an owned parse job; null covers foreign/missing jobs and deleted sources. */
export async function getParseJobSourceItemId(userId: string, jobId: string): Promise<string | null> {
  const job = await prisma.aiParseJob.findFirst({
    where: { id: jobId, userId },
    select: { sourceItemId: true },
  })
  return job?.sourceItemId ?? null
}

export interface ReparseEligibility {
  status: ParseJobStatus
  sourceItemId: string | null
}

/**
 * The per-job Re-parse button (v1.5) is `completed`-ONLY: a `processing` job is still streaming, a
 * `failed`/`closed` job is handled by the status-independent parse-from-stash on the source item instead.
 * Returns the job's status + source id (IDOR-scoped) so the route can 404 a foreign/missing job and 409 a
 * non-`completed` one. Null when the job isn't the user's.
 */
export async function getReparseEligibility(userId: string, jobId: string): Promise<ReparseEligibility | null> {
  const job = await prisma.aiParseJob.findFirst({
    where: { id: jobId, userId },
    select: { status: true, sourceItemId: true },
  })
  if (!job) return null
  return { status: job.status as ParseJobStatus, sourceItemId: job.sourceItemId }
}

// ── v1 source persistence ─────────────────────────────────────────────────────────────────────────

// The minimal source-item fields the parse route needs to read a job's source text (IDOR-scoped read).
export interface ParseSourceItem {
  id: string
  itemTypeName: string
  content: string | null
  // S3 object key for `file` items (the column is named `fileUrl` but stores the key).
  fileUrl: string | null
  fileName: string | null
}

export interface SourceTextResult {
  text: string
  truncated: boolean
  sourceName: string | null
}

// Boundary-truncates to the parse window, preferring the last paragraph break (`\n\n`) then line break
// (`\n`) in the back half before a hard cut, so the model never receives a mid-line/mid-word fragment.
function boundaryTruncate(text: string, maxChars: number): { text: string; truncated: boolean } {
  if (text.length <= maxChars) return { text, truncated: false }
  const slice = text.slice(0, maxChars)
  const paragraph = slice.lastIndexOf('\n\n')
  const line = slice.lastIndexOf('\n')
  const half = maxChars * 0.5
  let cut = maxChars
  if (paragraph > half) cut = paragraph
  else if (line > half) cut = line
  return { text: text.slice(0, cut), truncated: true }
}

/** IDOR-scoped read of a source candidate item (only the fields the parse read needs). */
export async function getSourceItemForParse(userId: string, itemId: string): Promise<ParseSourceItem | null> {
  const row = await prisma.item.findFirst({
    where: { id: itemId, userId },
    select: { id: true, content: true, fileUrl: true, fileName: true, itemType: { select: { name: true } } },
  })
  if (!row) return null
  return { id: row.id, itemTypeName: row.itemType.name, content: row.content, fileUrl: row.fileUrl, fileName: row.fileName }
}

/**
 * Resolves the boundary-truncated parse window for a source item (resource-minimal): a **note** or **snippet** slices
 * its already-loaded `content` in memory; a **file** does a bounded S3 range read (never the whole
 * object). Throws (caller maps to 422, no token spent) when the source is ineligible/unreadable — a
 * non-text type, a `file` without a `.txt`/`.md` name, or a missing/failed S3 object. Re-validates text
 * eligibility server-side; never trusts the client.
 */
export async function getSourceText(item: ParseSourceItem): Promise<SourceTextResult> {
  if (item.itemTypeName === 'note' || item.itemTypeName === 'snippet') {
    const result = boundaryTruncate(item.content ?? '', SPLIT_FILE_MAX_INPUT_CHARS)
    return { ...result, sourceName: deriveSourceName(item) }
  }
  if (item.itemTypeName === 'file') {
    if (!item.fileUrl) throw new Error('source file item has no stored object')
    const ext = item.fileName?.split('.').pop()?.toLowerCase() ?? ''
    if (!SPLIT_FILE_ALLOWED_EXTS.has(ext)) throw new Error('source file item is not a text file (.txt/.md)')
    const read = await getTextFromS3(item.fileUrl, SPLIT_FILE_MAX_INPUT_CHARS)
    const bounded = boundaryTruncate(read.text, SPLIT_FILE_MAX_INPUT_CHARS)
    return { text: bounded.text, truncated: read.truncated || bounded.truncated, sourceName: deriveSourceName(item) }
  }
  throw new Error(`ineligible source item type for parsing: ${item.itemTypeName}`)
}

function deriveSourceName(item: ParseSourceItem): string | null {
  if (item.fileName) return item.fileName
  const content = item.content ?? ''
  const firstLine = content.split('\n').find((line) => line.trim().length > 0)?.trim()
  return firstLine ? firstLine.slice(0, COLLECTION_NAME_MAX_CHARS) : null
}

export interface ParseSourceCandidate {
  itemId: string
  name: string
  sizeBytes: number | null
}

/** Which durable stash items the picker lists: eligible text `file`s, or `brain-dump`-tagged `note`s and `snippet`s. */
export type ParseSourceKind = 'file' | 'note'

/**
 * Lists eligible durable stash items for the "Select from my stash" picker (IDOR-scoped). Both kinds
 * require the `brain-dump` tag, so the picker lists only sources explicitly marked for parsing (the
 * feature tags its own uploads/paste-notes; a user can tag any item to opt it in):
 * - `file` — text `file` items ending in `.txt`/`.md` and tagged `brain-dump` ("My files" tab).
 * - `note` — `note` and `snippet` items tagged `brain-dump` ("Notes" tab), so a note or snippet marked for parsing
 *   (incl. a prior paste source the feature itself tagged) can be re-dumped. `sizeBytes` is the content length.
 */
export async function listParseSourceCandidates(
  userId: string,
  kind: ParseSourceKind = 'file',
): Promise<ParseSourceCandidate[]> {
  if (kind === 'note') {
    const rows = await prisma.item.findMany({
      where: {
        userId,
        itemType: { name: { in: ['note', 'snippet'] } },
        tags: { some: { name: BRAIN_DUMP_SOURCE_TAG } },
      },
      select: { id: true, title: true, content: true },
      orderBy: { createdAt: 'desc' },
      take: 50,
    })
    return rows.map((row) => ({
      itemId: row.id,
      name: row.title || 'Untitled source',
      sizeBytes: row.content ? Buffer.byteLength(row.content, 'utf8') : null,
    }))
  }

  const rows = await prisma.item.findMany({
    where: {
      userId,
      itemType: { name: 'file' },
      tags: { some: { name: BRAIN_DUMP_SOURCE_TAG } },
      OR: [
        { fileName: { endsWith: '.txt', mode: 'insensitive' } },
        { fileName: { endsWith: '.md', mode: 'insensitive' } },
      ],
    },
    select: { id: true, fileName: true, fileSize: true },
    orderBy: { createdAt: 'desc' },
    take: 50,
  })
  return rows.map((row) => ({ itemId: row.id, name: row.fileName ?? 'Untitled file', sizeBytes: row.fileSize }))
}

export interface DeleteJobResult {
  // The background-run id to cancel best-effort, present only when the job was still processing.
  openaiResponseId: string | null
}

/**
 * Discards a job: deletes the job + its drafts (cascade) + `sourceText`, but **keeps the source item**
 * (the FK is SetNull; we never delete the item here). Returns the OpenAI response id to cancel when the
 * job was still processing, or null. IDOR-scoped: returns null when the job isn't the user's.
 */
export async function deleteJob(userId: string, jobId: string): Promise<DeleteJobResult | null> {
  const job = await prisma.aiParseJob.findFirst({
    where: { id: jobId, userId },
    select: { openaiResponseId: true, status: true },
  })
  if (!job) return null
  await prisma.aiParseJob.deleteMany({ where: { id: jobId, userId } })
  log.info({ userId, jobId, status: job.status }, 'parse job discarded')
  return { openaiResponseId: job.status === 'processing' ? job.openaiResponseId : null }
}

// Hard cap on jobs purged per opportunistic sweep — keeps the lazy `after()` cleanup bounded so it
// never turns a single job-list/create request into a large delete. Stragglers are caught next sweep.
const PARSE_JOB_SWEEP_LIMIT = 50

// Global cooldown between opportunistic sweeps. The sweep fires from every job-list/create request, so
// without this a polled endpoint would run one global scan+delete per request. A Redis `SET NX EX`
// guard lets at most one sweep proceed per window, decoupling sweep frequency from request volume.
const PARSE_JOB_SWEEP_COOLDOWN_SECONDS = 300
const PARSE_JOB_SWEEP_LOCK_KEY = 'parse-job-sweep:cooldown'

// In-process fallback throttle: the last time this server instance ran (or claimed) a sweep. Guards the
// Redis-unavailable path so a polled endpoint can't run one global scan+delete per request even when the
// distributed cooldown is gone. Per-instance only (resets on cold start), which is fine for a backstop.
let lastSweepClaimMs = 0

// Claims the sweep cooldown: returns true if this caller won the window (and should sweep), false if a
// recent sweep already holds it. When Redis is unavailable it falls back to an in-process timestamp guard
// (still throttled per instance) instead of failing fully open, since the always-mounted dashboard widget
// polls the job list.
async function claimSweepWindow(now: number): Promise<boolean> {
  const redis = getRedis()
  if (!redis) {
    if (now - lastSweepClaimMs < PARSE_JOB_SWEEP_COOLDOWN_SECONDS * 1000) return false
    lastSweepClaimMs = now
    return true
  }
  try {
    const won = await redis.set(PARSE_JOB_SWEEP_LOCK_KEY, '1', { nx: true, ex: PARSE_JOB_SWEEP_COOLDOWN_SECONDS })
    return won === 'OK'
  } catch (err) {
    // Redis is flapping — fall through to the SAME in-process timestamp guard the no-Redis branch uses so
    // the cooldown still applies during an outage (otherwise every request would run a full global scan).
    if (now - lastSweepClaimMs < PARSE_JOB_SWEEP_COOLDOWN_SECONDS * 1000) return false
    lastSweepClaimMs = now
    log.warn({ err }, 'parse-job sweep cooldown check failed — proceeding under in-process throttle')
    return true
  }
}

// Pure cutoff: the `updatedAt` threshold below which a job is considered abandoned. Anything last
// touched before `now - ttlMs` is stale. Exported for direct unit testing of the cutoff math.
export function parseJobAbandonCutoff(now: number, ttlMs: number = PARSE_JOB_TTL_MS): Date {
  return new Date(now - ttlMs)
}

export interface SweepAbandonedResult {
  swept: number
}

/**
 * Opportunistic GLOBAL purge of abandoned parse jobs (run via `after()` on job-list/create, not a
 * cron): deletes every job whose last activity (`updatedAt`) predates the 24 h cutoff — removing the
 * job + its drafts (cascade) + `sourceText`, while **keeping the durable source item** (the FK is
 * SetNull, exactly like manual Discard). Bounded by PARSE_JOB_SWEEP_LIMIT per run, and self-throttled
 * to one run per PARSE_JOB_SWEEP_COOLDOWN_SECONDS via a Redis cooldown so request volume can't amplify
 * it. Not user-scoped: this is a maintenance backstop, so it is intentionally global (the only such
 * helper here). Best-effort: any failure is logged and swallowed so it never breaks the triggering request.
 */
export async function sweepAbandonedParseJobs(now: number = Date.now()): Promise<SweepAbandonedResult> {
  try {
    if (!(await claimSweepWindow(now))) return { swept: 0 }
    const cutoff = parseJobAbandonCutoff(now)
    // Exclude `closed` (committed history) — never auto-purged. The exclusion is BY STATUS, not
    // `updatedAt`, so a late trash-commit refreshing a closed job's `updatedAt` is harmless.
    const stalePredicate: Prisma.AiParseJobWhereInput = {
      updatedAt: { lt: cutoff },
      status: { not: 'closed' },
    }
    const stale = await prisma.aiParseJob.findMany({
      where: stalePredicate,
      select: { id: true },
      take: PARSE_JOB_SWEEP_LIMIT,
    })
    if (stale.length === 0) return { swept: 0 }
    // deleteMany on the selected ids — drafts cascade, sourceText goes with the row, the source item is
    // kept (onDelete: SetNull). No OpenAI cancel: a 24 h-stale background run is long gone. TOCTOU guard:
    // the WHERE RE-ASSERTS the staleness predicate (not just `id IN […]`), so a job resumed/committed/
    // closed in the findMany→deleteMany window no longer matches and is skipped atomically — we never
    // delete just-revived work.
    const result = await prisma.aiParseJob.deleteMany({
      where: { AND: [{ id: { in: stale.map((job) => job.id) } }, stalePredicate] },
    })
    const skipped = stale.length - result.count
    if (skipped > 0) log.info({ skipped, cutoff: cutoff.toISOString() }, 'parse-job sweep skipped revived jobs (TOCTOU)')
    log.info({ swept: result.count, cutoff: cutoff.toISOString() }, 'abandoned parse jobs swept')
    return { swept: result.count }
  } catch (err) {
    log.error({ err }, 'abandoned parse-job sweep failed')
    return { swept: 0 }
  }
}

/**
 * Self-heal a close-pending job. The close write (set `closed` + clear `sourceText` + stamp stats) runs
 * AFTER the per-draft commits, so a crash in between leaves a `completed`/`failed` job with zero
 * non-trashed drafts — implicit close-pending. Any read that observes that shape completes the close
 * idempotently (`closeJob` is scoped to `status != 'closed'`, so a concurrent read is a no-op). No lost
 * drafts, no stuck job. The committed types are already gone (their drafts were deleted) AND each per-item
 * commit recorded itself on the running tally via `recordInReviewCommit`, so the close stamped here passes
 * no new types — `closeJob` reads and preserves the already-accumulated `committedCount`/`committedByType`,
 * giving a healed job an accurate total. Returns true when it healed (caller re-reads status).
 */
async function healClosePending(
  userId: string,
  jobId: string,
  status: string,
  nonTrashedCount: number,
): Promise<boolean> {
  // Close-pending self-heal is `completed`-ONLY. A `failed` job with zero non-trashed drafts is NOT
  // close-pending — it must stay reachable so the user can see its remediation detail; auto-closing it
  // would clear `sourceText` and drop it from the active list, destroying that detail.
  if (status !== 'completed') return false
  if (nonTrashedCount > 0) return false
  const total = await closeJob(userId, jobId, [])
  if (total !== null) log.info({ userId, jobId, committedCount: total }, 'parse job close self-healed')
  return total !== null
}

/** IDOR-scoped: only returns the job when it belongs to the session user. */
export async function getParseJobSnapshot(userId: string, jobId: string): Promise<ParseJobSnapshot | null> {
  const job = await prisma.aiParseJob.findFirst({
    where: { id: jobId, userId },
    select: {
      status: true,
      progress: true,
      error: true,
      committedCount: true,
      committedByType: true,
      collectionName: true,
      collectionIds: true,
      sourceItemId: true,
      sourceName: true,
      truncated: true,
      sourceItem: { select: { itemType: { select: { name: true } } } },
      // `createdAt` tiebreaks a duplicate `order` (drag can assign duplicates) so the board ordering is
      // stable — `order` is advisory, not unique.
      items: { select: DRAFT_SELECT, orderBy: [{ order: 'asc' }, { createdAt: 'asc' }] },
    },
  })
  if (!job) return null

  // Self-heal a close-pending job (in-review with zero non-trashed drafts) before building the snapshot.
  // The heal writes `status='closed'` + clears `sourceText` and preserves the already-accumulated
  // `committedCount`/`committedByType` (it closes with no new types). Rather than re-running the whole
  // builder against the just-closed row, we mutate the in-memory `job` to that closed shape and continue —
  // `committedCount`/`committedByType` are already what the heal preserves, `sourceText` isn't part of the
  // snapshot, and a `closed` status drops it out of the de-dup branch below (only trash remains).
  const nonTrashed = job.items.filter((item) => !item.trashed)
  if (await healClosePending(userId, jobId, job.status, nonTrashed.length)) {
    job.status = 'closed'
  }

  // Advisory de-dup, batched once per snapshot load: flag drafts that duplicate an existing stash item.
  // Only non-trashed drafts are checked (a trashed draft won't commit, so a badge would be noise), and
  // only on a committable job — `completed` OR `failed` (both let the user commit partials); skips
  // `processing` (wasted work on the hot stream-seed path) and `closed` (only trashed drafts remain). The
  // job's own source item is excluded so paste/select drafts don't all match their source text.
  const committable = job.status === 'completed' || job.status === 'failed'
  const checkable = committable ? nonTrashed : []
  const duplicates = await findDuplicateMatches(userId, checkable, job.sourceItemId)
  const items: ParseDraftItemDTO[] = job.items.map((item) => ({
    ...item,
    duplicateOf: duplicates.get(item.id) ?? null,
  }))

  return {
    status: job.status as ParseJobStatus,
    progress: job.progress,
    error: job.error,
    committedCount: job.committedCount,
    committedByType: job.committedByType ? asCommittedByType(job.committedByType) : null,
    collectionName: job.collectionName,
    collectionIds: job.collectionIds,
    sourceItemId: job.sourceItemId,
    sourceItemType: job.sourceItem?.itemType.name ?? null,
    sourceName: job.sourceName,
    truncated: job.truncated,
    items,
  }
}

/** IDOR-scoped read of everything the stream route needs to start, resume, or attach. */
export async function getParseJobRunState(userId: string, jobId: string): Promise<ParseJobRunState | null> {
  const job = await prisma.aiParseJob.findFirst({
    where: { id: jobId, userId },
    select: {
      status: true,
      sourceText: true,
      openaiResponseId: true,
      streamCursor: true,
      _count: { select: { items: true } },
    },
  })
  if (!job) return null
  return {
    status: job.status as ParseJobStatus,
    sourceText: job.sourceText,
    openaiResponseId: job.openaiResponseId,
    streamCursor: job.streamCursor,
    itemCount: job._count.items,
  }
}

/**
 * Lists jobs awaiting review for the badge + /parse index: `processing` (always), `failed` (always, so a
 * failed job stays reachable after its toast is gone — its remediation detail and committable partials
 * must remain visible even with zero drafts), and `completed` that still has a committable (non-trashed)
 * draft. `closed` is excluded (it lives in the History list). A `completed` job with ONLY trashed drafts is
 * close-pending; this read self-heals it to `closed` (so it drops out of the active list) before returning.
 * `failed` is NEVER self-healed — it is a terminal review state, not close-pending.
 */
export async function listActiveParseJobs(userId: string): Promise<ParseJobSummary[]> {
  // Self-heal pass: complete the close of any `completed` job left with zero non-trashed drafts, so it
  // doesn't linger in the active list. Bounded to the user's own jobs; cheap (a count + conditional write).
  // `failed` is excluded — it stays reachable with its remediation rather than being closed.
  const pending = await prisma.aiParseJob.findMany({
    where: {
      userId,
      status: 'completed',
      items: { none: { trashed: false } },
    },
    select: { id: true },
  })
  await Promise.all(pending.map((job) => closeJob(userId, job.id, [])))

  const jobs = await prisma.aiParseJob.findMany({
    where: {
      userId,
      OR: [
        { status: 'processing' },
        { status: 'failed' },
        { status: 'completed', items: { some: { trashed: false } } },
      ],
    },
    select: {
      id: true,
      status: true,
      progress: true,
      sourceName: true,
      collectionName: true,
      createdAt: true,
      // Count only the committable (non-trashed) drafts so the badge reflects what will be saved.
      _count: { select: { items: { where: { trashed: false } } } },
    },
    orderBy: { createdAt: 'desc' },
  })
  return jobs.map((job) => ({
    id: job.id,
    status: job.status as ParseJobStatus,
    progress: job.progress,
    itemCount: job._count.items,
    sourceName: job.sourceName,
    collectionName: job.collectionName,
    createdAt: job.createdAt.toISOString(),
  }))
}

/**
 * Lists the user's `closed` history jobs (post-commit stubs) for the /parse "History" section, newest
 * first, paginated by `take`. IDOR-scoped. Each row carries the stub stats (`committedCount`/
 * `committedByType`) for the history label and `itemCount` = leftover trashed drafts still committable.
 */
export async function listClosedParseJobs(userId: string, take: number = 50): Promise<ParseJobSummary[]> {
  const jobs = await prisma.aiParseJob.findMany({
    where: { userId, status: 'closed' },
    select: {
      id: true,
      status: true,
      progress: true,
      sourceName: true,
      collectionName: true,
      createdAt: true,
      committedCount: true,
      committedByType: true,
      _count: { select: { items: { where: { trashed: true } } } },
    },
    orderBy: { createdAt: 'desc' },
    take,
  })
  return jobs.map((job) => ({
    id: job.id,
    status: job.status as ParseJobStatus,
    progress: job.progress,
    itemCount: job._count.items,
    sourceName: job.sourceName,
    collectionName: job.collectionName,
    createdAt: job.createdAt.toISOString(),
    committedCount: job.committedCount,
    committedByType: job.committedByType ? asCommittedByType(job.committedByType) : null,
  }))
}

/** Records the OpenAI background-run id once the first stream event arrives (IDOR-scoped). */
export async function setOpenAiResponseId(userId: string, jobId: string, responseId: string): Promise<void> {
  await prisma.aiParseJob.updateMany({ where: { id: jobId, userId }, data: { openaiResponseId: responseId } })
}

/** Advances the resume cursor (last clean-boundary event sequence number) (IDOR-scoped). */
export async function updateStreamCursor(userId: string, jobId: string, cursor: number): Promise<void> {
  await prisma.aiParseJob.updateMany({ where: { id: jobId, userId }, data: { streamCursor: cursor } })
}

/**
 * Atomically persists a clean-boundary batch of streamed drafts AND advances the resume cursor +
 * progress in a single transaction, returning the saved rows for SSE emission. Bundling the draft
 * writes with the cursor advance is what makes resume safe: a crash either commits both or neither,
 * so a persisted draft can never sit ahead of the cursor and be replayed (duplicated) on resume. An
 * empty batch (a boundary that produced no new item) just advances the cursor.
 */
export async function appendDraftsAndAdvance(
  userId: string,
  jobId: string,
  drafts: BrainDumpDraft[],
  startOrder: number,
  cursor: number | null,
): Promise<ParseDraftItemDTO[]> {
  if (drafts.length === 0) {
    // Empty batch (a boundary that produced no item) — just advance the cursor. One statement, so no
    // transaction is needed.
    if (cursor !== null) {
      await prisma.aiParseJob.updateMany({ where: { id: jobId, userId }, data: { streamCursor: cursor } })
    }
    return []
  }
  const progress = brainDumpProgress(startOrder + drafts.length)
  return prisma.$transaction(async (tx) => {
    // Sequential (not Promise.all) so the writes are dispatched in `order` on the transaction's single
    // connection — the canonical interactive-transaction pattern on the Neon adapter. Awaits in the
    // loop, so `for...of`.
    const saved: ParseDraftItemDTO[] = []
    for (const [i, draft] of drafts.entries()) {
      const row = await tx.aiParseJobItem.create({
        data: {
          jobId,
          userId,
          order: startOrder + i,
          itemTypeName: draft.itemTypeName,
          title: draft.title,
          content: draft.content,
          url: draft.url,
          language: draft.language,
          description: draft.description,
          tags: draft.tags,
        },
        select: DRAFT_SELECT,
      })
      saved.push(row)
    }
    await tx.aiParseJob.updateMany({
      where: { id: jobId, userId },
      data: { progress, ...(cursor !== null ? { streamCursor: cursor } : {}) },
    })
    return saved
  })
}

// Optional structured failure passed when `status === 'failed'`: the category drives the rich detail +
// remediation written to `error`; the stream route composes the human-readable string via
// `buildFailureDetail`. `failureReason` is also logged (structured) for observability.
export interface FinishJobFailure {
  reason: BrainDumpFailureReason
}

export async function finishJob(
  userId: string,
  jobId: string,
  status: Extract<ParseJobStatus, 'completed' | 'failed'>,
  // The rich, human-readable detail for a `failed` job (built by `buildFailureDetail`), or undefined for
  // a clean finish. Stored verbatim in the free-text `error` column; the board renders it.
  error?: string,
  // Set when the run ended `incomplete` (OpenAI `max_output_tokens`): the job is terminal-completed but
  // its tail was never parsed, so we reuse the `truncated` flag to disclose the partial result.
  truncated?: boolean,
  // The failure category, logged structurally so a `failed` transition is queryable (per observability).
  failure?: FinishJobFailure,
): Promise<void> {
  const progress = status === 'completed' ? 100 : undefined
  await prisma.aiParseJob.updateMany({
    where: { id: jobId, userId },
    data: {
      status,
      error: error ?? null,
      ...(progress !== undefined ? { progress } : {}),
      ...(truncated ? { truncated: true } : {}),
    },
  })
  if (status === 'failed') {
    log.warn({ userId, jobId, failureReason: failure?.reason ?? 'unknown' }, 'parse job failed')
  } else {
    log.info({ userId, jobId, status, truncated: Boolean(truncated) }, 'parse job finished')
  }
}

export interface UpdateJobCollectionsInput {
  collectionName?: string | null
  collectionIds?: string[]
}

export type UpdateJobCollectionsResult = 'not_found' | 'invalid_collections' | 'ok'

/** IDOR-scoped update of a job's commit-time collection target (new-collection name + existing ids). */
export async function updateJobCollections(
  userId: string,
  jobId: string,
  input: UpdateJobCollectionsInput,
): Promise<UpdateJobCollectionsResult> {
  const data: Prisma.AiParseJobUpdateManyMutationInput = {}
  if (input.collectionName !== undefined) {
    data.collectionName = input.collectionName?.trim().slice(0, COLLECTION_NAME_MAX_CHARS) || null
  }
  if (input.collectionIds !== undefined) {
    const rows = await prisma.collection.findMany({
      where: { id: { in: input.collectionIds }, userId },
      select: { id: true },
    })
    if (rows.length !== input.collectionIds.length) return 'invalid_collections'
    data.collectionIds = rows.map((row) => row.id)
  }
  const result = await prisma.aiParseJob.updateMany({ where: { id: jobId, userId }, data })
  return result.count > 0 ? 'ok' : 'not_found'
}

export interface PatchDraftItemInput {
  itemTypeName?: string
  order?: number
  title?: string
  content?: string | null
  url?: string | null
  language?: string | null
  description?: string | null
  tags?: string[]
  // Soft-delete toggle: true moves the draft to the Trash bucket, false restores it.
  trashed?: boolean
}

/**
 * IDOR-scoped patch (drag/reorder/edit), scoped to the addressed `jobId` so a mismatched job/item pair
 * 404s. Returns the updated row, or null when it isn't the user's. On a reclassification (the patch
 * sets `itemTypeName`) the fields the new type can't carry are nulled, mirroring `parseSplitLine`'s
 * type-field reconciliation — otherwise a draft dragged e.g. snippet→link would keep its `content`/
 * `language` and commit into a malformed item.
 */
export async function patchDraftItem(
  userId: string,
  jobId: string,
  itemId: string,
  patch: PatchDraftItemInput,
): Promise<ParseDraftItemDTO | null> {
  const data: PatchDraftItemInput = { ...patch }
  if (patch.itemTypeName !== undefined) {
    const type = patch.itemTypeName
    if (!ITEM_TYPES_WITH_CONTENT.has(type)) data.content = null
    if (!ITEM_TYPES_WITH_LANGUAGE.has(type)) data.language = null
    if (type !== 'link') data.url = null
  }
  const result = await prisma.aiParseJobItem.updateMany({ where: { id: itemId, jobId, userId }, data })
  if (result.count === 0) return null
  return prisma.aiParseJobItem.findFirst({ where: { id: itemId, jobId, userId }, select: DRAFT_SELECT })
}

/** IDOR-scoped delete of a single draft, scoped to the addressed `jobId`. Returns whether a row was removed. */
export async function deleteDraftItem(userId: string, jobId: string, itemId: string): Promise<boolean> {
  const result = await prisma.aiParseJobItem.deleteMany({ where: { id: itemId, jobId, userId } })
  return result.count > 0
}

/**
 * IDOR-scoped "empty trash": permanently removes every trashed draft of a job. Returns the deleted
 * count, or null when the job isn't the user's (so the route can 404 instead of a false 204), keeping
 * the same not-found semantics as the other job routes.
 */
export async function emptyJobTrash(userId: string, jobId: string): Promise<number | null> {
  const job = await prisma.aiParseJob.findFirst({ where: { id: jobId, userId }, select: { id: true } })
  if (!job) return null
  const result = await prisma.aiParseJobItem.deleteMany({ where: { jobId, userId, trashed: true } })
  log.info({ userId, jobId, deleted: result.count }, 'parse job trash emptied')
  return result.count
}

// Maps a committed draft to the createItem payload — text item types only, so the file fields are null.
function draftToItemInput(draft: ParseDraftItemDTO, collectionIds: string[]): CreateItemInput {
  return {
    title: draft.title,
    description: draft.description,
    content: draft.content,
    url: draft.url,
    fileUrl: null,
    fileName: null,
    fileSize: null,
    language: draft.language,
    tags: draft.tags,
    itemTypeName: draft.itemTypeName,
    collectionIds,
  }
}

/** Whether the job has a pending new-collection name that hasn't been materialized into a collection yet. */
async function hasPendingNewCollection(userId: string, jobId: string): Promise<boolean> {
  const job = await prisma.aiParseJob.findFirst({
    where: { id: jobId, userId },
    select: { collectionName: true },
  })
  return Boolean(job?.collectionName?.trim())
}

/**
 * Resolves the collection ids to attach when committing drafts (per-item "Save now" and the batch
 * "Save all"): the job's selected existing collections plus, the first time it runs with a pending
 * new-collection name, a freshly-created collection whose id is persisted back onto the job.
 *
 * Concurrency-safe against duplicate creation: the name is "claimed" with a guarded `updateMany`
 * (`where.collectionName === newName` → `null`). Under Postgres Read Committed, a concurrent claim on
 * the same row blocks, then re-checks that `where` against the updated row — which no longer matches —
 * so it affects 0 rows. Exactly one caller sees `count === 1` and creates the collection; the rest see
 * `count === 0` and reuse the persisted id. No duplicate is ever created. IDOR-scoped; returns null
 * when the job isn't the user's.
 *
 * When `skipNewCollection` is true, the new-collection name is NOT created — only the existing
 * `collectionIds` are returned (the per-item "Save now" cancel path: commit the item with no new
 * collection). The pending name stays on the job for a later "Save all" to materialize.
 */
async function resolveJobCollectionIds(
  userId: string,
  jobId: string,
  skipNewCollection: boolean = false,
): Promise<string[] | null> {
  const job = await prisma.aiParseJob.findFirst({
    where: { id: jobId, userId },
    select: { collectionName: true, collectionIds: true },
  })
  if (!job) return null

  const newName = job.collectionName?.trim()
  if (!newName || skipNewCollection) return job.collectionIds

  // Claim → create → persist in ONE transaction so the claimed row stays locked until the new id is
  // written. A concurrent caller that loses the claim blocks on the row and only re-reads after this
  // transaction commits, so it can never attach drafts to a `collectionIds` set that still excludes
  // the freshly-created collection. (The create runs on `tx` too, so a rollback leaves no orphan.)
  return prisma.$transaction(async (tx) => {
    const claim = await tx.aiParseJob.updateMany({
      where: { id: jobId, userId, collectionName: newName },
      data: { collectionName: null },
    })
    if (claim.count === 0) {
      // A concurrent save already claimed the name and created the collection — reuse its persisted id.
      const fresh = await tx.aiParseJob.findFirst({
        where: { id: jobId, userId },
        select: { collectionIds: true },
      })
      return fresh?.collectionIds ?? job.collectionIds
    }

    const collection = await tx.collection.create({
      data: { userId, name: newName.slice(0, COLLECTION_NAME_MAX_CHARS) },
      select: { id: true },
    })
    const ids = [...job.collectionIds, collection.id]
    await tx.aiParseJob.updateMany({ where: { id: jobId, userId }, data: { collectionIds: ids } })
    return ids
  })
}

/**
 * Shared commit core for per-item "Save now" (one draft) and batch "Save all" (a job's drafts): for
 * each draft, **delete-guards-create** inside ONE interactive `$transaction` — delete the draft row
 * first, and only if that delete removed a row (`count === 1`) create the real item on the same `tx`.
 * A 0-row delete means another tab/commit already took this draft, so we skip and create nothing — this
 * is what kills the double-commit race without a lock: two concurrent commits of the same draft can't
 * both see `count === 1`, so the item is created at most once. The whole pair is atomic, so a crash
 * mid-draft commits both the delete and the create or neither (no duplicate on retry, no orphaned draft).
 *
 * The batch still iterates draft-by-draft (sequential, deterministic order, bounded connection pressure)
 * so a per-draft failure — `createItem` returning null, e.g. a bad type — leaves that draft committable
 * while the rest succeed. A null `createItem` throws here to roll its own transaction back (the draft is
 * NOT deleted) and is caught so the batch continues. Returns the count created plus the list of committed
 * draft types (for the closed-job per-type stub stats).
 */
interface CommitDraftsResult {
  created: number
  committedTypes: string[]
}

// Sentinel thrown to roll the per-draft tx back when `createItem` returns null (an EXPECTED skip — e.g. an
// unresolved item type — not a DB fault). Compared by identity below so the expected skip is logged at
// `warn` while a genuine Prisma reject (a different thrown value) is logged at `error`. Identity comparison,
// not `instanceof`/`error.name` routing.
const DRAFT_COMMIT_SKIP = new Error('createItem returned null')

async function commitDrafts(
  userId: string,
  jobId: string,
  collectionIds: string[],
  drafts: ParseDraftItemDTO[],
): Promise<CommitDraftsResult> {
  const committedTypes: string[] = []
  // Awaits per draft (interactive tx + sequential ordering), so `for...of`.
  for (const draft of drafts) {
    // A `link` draft with no URL would commit as a URL-typed item with a null `url` (a broken link item),
    // since `url` is free-text-nullable on the draft and `createItem` flips `contentType` to URL for the
    // `link` type. Skip it — don't delete, don't create — so the draft stays committable and the user can
    // add a URL (or reclassify it) before saving.
    if (draft.itemTypeName === 'link' && !draft.url?.trim()) {
      log.warn({ userId, draftId: draft.id }, 'parse draft commit skipped — link draft has no url, draft kept')
      continue
    }
    try {
      const item = await prisma.$transaction(async (tx) => {
        // Scope the delete to the addressed job too (not just userId), matching the other draft helpers
        // and guarding against a draft from a different job ever slipping into this batch.
        const removed = await tx.aiParseJobItem.deleteMany({ where: { id: draft.id, jobId, userId } })
        // Lost the race for this draft (already committed/deleted elsewhere) — create nothing.
        if (removed.count === 0) return null
        const made = await createItem(userId, draftToItemInput(draft, collectionIds), tx)
        // createItem couldn't build the item (e.g. unresolved type) — throw the sentinel to roll back the
        // delete so the draft survives and stays committable. Caught below as the expected skip (warn).
        if (!made) throw DRAFT_COMMIT_SKIP
        return made
      })
      if (item) committedTypes.push(draft.itemTypeName)
    } catch (err) {
      // The expected null-type skip vs a genuine DB fault: the sentinel keeps the draft committable by
      // design (warn); anything else is a real fault that also left the draft uncommitted (error).
      if (err === DRAFT_COMMIT_SKIP) {
        log.warn({ userId, draftId: draft.id }, 'parse draft commit skipped — unresolved type, draft kept')
      } else {
        log.error({ userId, draftId: draft.id, err }, 'parse draft commit failed — draft kept')
      }
    }
  }
  return { created: committedTypes.length, committedTypes }
}

/**
 * Demotes a committed job to the terminal `closed` history stub: sets `status='closed'`, clears
 * `sourceText` (the parse window is no longer needed — matches Discard's lifecycle but keeps the row),
 * and merges the just-committed types into the running per-type tally (`committedByType` + the
 * `committedCount` total). Trashed drafts are intentionally kept so a closed job still shows its Trash
 * bucket. Idempotent and self-healing: scoped to `status != 'closed'` so a concurrent/duplicate close
 * is a no-op, and callable on a `completed` job that has zero non-trashed drafts left (the close-pending
 * shape a crash-after-commit leaves behind). Returns the new running total, or null if nothing to close.
 */
async function closeJob(userId: string, jobId: string, committedTypes: string[]): Promise<number | null> {
  // The demote and the final stats merge run in one tx so a closed job never lands with a status set but
  // its stats unstamped. `committedTypes` is the LAST batch only (per-item commits already recorded their
  // own as they landed, via `recordInReviewCommit`); for "Save all" it's the whole batch (recorded here).
  return bumpCommittedStats({ id: jobId, userId, status: { not: 'closed' } }, committedTypes, {
    status: 'closed',
    sourceText: '',
  })
}

/**
 * Merges a late trash-bucket commit's types into an ALREADY-closed job's stub stats (the closed board
 * lets the user still commit trashed drafts). Additive `committedByType` + `committedCount`, scoped to
 * `status='closed'`. No status change — the job stays closed. Returns the new total, or null if the job
 * isn't a closed job of this user.
 */
async function mergeClosedJobStats(userId: string, jobId: string, committedTypes: string[]): Promise<number | null> {
  if (committedTypes.length === 0) return null
  return bumpCommittedStats({ id: jobId, userId, status: 'closed' }, committedTypes)
}

// Per-item "Save now" outcome. `needsCollectionConfirm` true means the commit was HELD (item NOT saved)
// because the job has a pending new collection and the caller hasn't decided yet — the client shows the
// confirm dialog then re-commits. Otherwise `created` is 0 or 1 and `autoClosed` is true when this commit
// drained the last non-trashed draft (→ dashboard redirect). `null` = draft wasn't the user's/committable.
export interface CommitDraftItemResult {
  created: number
  autoClosed: boolean
  needsCollectionConfirm: boolean
}

// `confirmCreateCollection`: undefined → ask first if a new collection is pending (return needs-confirm);
// true → create + attach it; false → commit WITHOUT the new collection (the cancel path) but attach
// existing ids. Ignored when the job has no pending new collection.
export interface CommitDraftItemOptions {
  confirmCreateCollection?: boolean
}

/**
 * Commits a single draft into a real item (per-item "Save now"), attaching it to the job's resolved
 * collection target. `commitDrafts` deletes the draft and creates the item atomically. IDOR-scoped:
 * returns null when the draft isn't the user's/committable.
 *
 * Collection-confirm gate: if the job has a pending (uncreated) new collection and the caller passed no
 * `confirmCreateCollection`, the commit is HELD and `needsCollectionConfirm` is returned so the client can
 * prompt. `true` creates+attaches it; `false` commits with only the existing collection ids.
 *
 * v2.5 lifecycle: after a successful in-review commit that drains the last non-trashed draft, the job
 * auto-closes (demote to `closed`, stamp stats) and `autoClosed` is set (→ dashboard redirect). A commit
 * on an already-`closed` job (its Trash bucket stays committable) instead MERGES its type into the stub
 * stats. Spends no AI budget.
 */
export async function commitDraftItem(
  userId: string,
  jobId: string,
  itemId: string,
  options: CommitDraftItemOptions = {},
): Promise<CommitDraftItemResult | null> {
  // The job status decides the post-commit path: in-review job → maybe auto-close; closed job → merge stats.
  const job = await prisma.aiParseJob.findFirst({ where: { id: jobId, userId }, select: { status: true } })
  if (!job) return null
  // On a `closed` job the only remaining drafts are the TRASHED ones, and the closed board lets the user
  // still commit them — so don't constrain `trashed` there. On an in-review job a trashed draft must not
  // commit (the user moved it to Trash), so require `trashed: false`.
  const draft = await prisma.aiParseJobItem.findFirst({
    where: { id: itemId, jobId, userId, ...(job.status === 'closed' ? {} : { trashed: false }) },
    select: DRAFT_SELECT,
  })
  if (!draft) return null

  // Collection-confirm gate: ask before silently materializing the job's pending new collection.
  if (options.confirmCreateCollection === undefined && (await hasPendingNewCollection(userId, jobId))) {
    return { created: 0, autoClosed: false, needsCollectionConfirm: true }
  }
  // confirm === false → commit without creating the new collection (cancel path); true/no-pending → normal.
  const skipNewCollection = options.confirmCreateCollection === false
  const collectionIds = (await resolveJobCollectionIds(userId, jobId, skipNewCollection)) ?? []
  const { created, committedTypes } = await commitDrafts(userId, jobId, collectionIds, [draft])
  if (created === 0) return { created: 0, autoClosed: false, needsCollectionConfirm: false } // kept for retry.

  if (job.status === 'closed') {
    await mergeClosedJobStats(userId, jobId, committedTypes)
    log.info({ userId, jobId, itemId }, 'parse draft committed (closed job — stats merged)')
    return { created, autoClosed: false, needsCollectionConfirm: false }
  }

  // In-review job: record this commit on the running tally immediately so the eventual close carries an
  // accurate total even when the user saved the drafts one at a time (not just the final draft's type).
  await recordInReviewCommit(userId, jobId, committedTypes)

  // If this drained the last non-trashed draft, complete the close now. The stats are already recorded
  // above, so `closeJob` only stamps the demote (status/sourceText) — no types passed, no double-count.
  const remaining = await prisma.aiParseJobItem.count({ where: { jobId, userId, trashed: false } })
  let autoClosed = false
  if (remaining === 0) {
    const total = await closeJob(userId, jobId, [])
    autoClosed = total !== null
    if (autoClosed) log.info({ userId, jobId, committedCount: total }, 'parse job auto-closed (last draft committed)')
  }
  log.info({ userId, jobId, itemId, collections: collectionIds.length, autoClosed }, 'parse draft committed')
  return { created, autoClosed, needsCollectionConfirm: false }
}

export type CommitJobResult =
  | { kind: 'not_found' }
  | { kind: 'still_processing' }
  // `closed` is true when every committable draft was saved and the job was demoted to the history stub.
  | { kind: 'done'; created: number; total: number; closed: boolean }

/**
 * Commits every non-trashed draft of a job into real items, then — when all of them saved — demotes the
 * job to the terminal `closed` history stub (v2.5: NOT a delete). The trashed drafts are kept so the
 * closed job still shows its Trash bucket. On a partial failure (some drafts couldn't be created) the
 * job stays `completed`/`failed` so the user can retry the survivors. IDOR-scoped. Spends no AI budget.
 * The caller invalidates the items cache. Rejects `processing` (still streaming) and `closed` (terminal).
 */
export async function commitJob(userId: string, jobId: string): Promise<CommitJobResult> {
  const job = await prisma.aiParseJob.findFirst({
    where: { id: jobId, userId },
    select: {
      status: true,
      // Trashed drafts are excluded — committing never resurrects a draft the user moved to Trash.
      // Secondary `createdAt` key keeps ordering deterministic if two drafts share an `order` value
      // (a client drag can assign duplicates — `order` is advisory, not unique).
      items: { where: { trashed: false }, select: DRAFT_SELECT, orderBy: [{ order: 'asc' }, { createdAt: 'asc' }] },
    },
  })
  if (!job) return { kind: 'not_found' }
  if (job.status === 'processing') return { kind: 'still_processing' }
  // A closed job has no committable (non-trashed) drafts; "Save all" doesn't apply — treat as a no-op done.
  if (job.status === 'closed') return { kind: 'done', created: 0, total: 0, closed: true }

  // No committable drafts (e.g. a race drained them, or a self-heal is pending): close to history without
  // resolving collections first — otherwise the pending new collection would be materialized for a job
  // that saved nothing, leaving a stray empty collection. A `failed` job is NEVER auto-closed here,
  // though: it must stay reachable with its remediation + `sourceText`, so an empty "Save all" is a no-op.
  if (job.items.length === 0) {
    if (job.status === 'failed') return { kind: 'done', created: 0, total: 0, closed: false }
    const total = await closeJob(userId, jobId, [])
    return { kind: 'done', created: 0, total: 0, closed: total !== null }
  }

  // Resolve the commit-time collection target (existing ids + a once-created new collection), shared
  // with per-item "Save now" so the two paths never create duplicate collections. `createItem`
  // re-validates each id against the user, so the stored existing ids are IDOR-safe at attach time.
  const targetCollectionIds = (await resolveJobCollectionIds(userId, jobId)) ?? []

  const { created, committedTypes } = await commitDrafts(userId, jobId, targetCollectionIds, job.items)

  // Demote to the `closed` history stub only when every committable draft was saved — commitDrafts
  // already deleted each committed draft, so only trashed drafts remain (kept). On a partial failure the
  // unsaved drafts remain and the job stays in review for the user to retry rather than closing early.
  let closed = false
  if (created === job.items.length) {
    const total = await closeJob(userId, jobId, committedTypes)
    closed = total !== null
  } else {
    // Partial failure: the job stays in review, but the drafts that DID commit must still land on the
    // running tally — otherwise they're saved-and-deleted yet uncounted, and the final history stats
    // (stamped when the survivors are later committed) undercount by this batch.
    await recordInReviewCommit(userId, jobId, committedTypes)
  }
  log.info(
    { userId, jobId, created, total: job.items.length, collections: targetCollectionIds.length, closed },
    'parse job committed',
  )
  return { kind: 'done', created, total: job.items.length, closed }
}
