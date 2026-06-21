import 'server-only'
import type { Prisma } from '@/generated/prisma/client'
import { prisma } from '@/lib/infra/prisma'
import { logger } from '@/lib/infra/pino'
import { createItem, type CreateItemInput } from '@/lib/db/items'
import { getTextFromS3 } from '@/lib/storage/s3'
import {
  COLLECTION_NAME_MAX_CHARS,
  SPLIT_FILE_MAX_INPUT_CHARS,
  SPLIT_FILE_ALLOWED_EXTS,
  ITEM_TYPES_WITH_CONTENT,
  ITEM_TYPES_WITH_LANGUAGE,
} from '@/lib/utils/constants'
import { brainDumpProgress, type BrainDumpDraft } from '@/lib/ai/brain-dump'

// Data access for the AI File Splitter staging tables (`AiParseJob` + `AiParseJobItem`). These are
// short-lived draft/staging rows: a job is created on upload, items are appended live as the model
// streams, the user edits/reclassifies them, and the whole job is deleted on commit. Every read is
// per-user and live, so none of these helpers use `'use cache'` — a cached snapshot would defeat the
// stream/refresh-resume flow and serve stale drafts the moment the user edits one.

const log = logger.child({ tag: 'ai-parse-jobs' })

export type ParseJobStatus = 'processing' | 'completed' | 'failed'

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

// One row in the in-progress list (entry-card badge + /parse index).
export interface ParseJobSummary {
  id: string
  status: ParseJobStatus
  progress: number
  itemCount: number
  sourceName: string | null
  createdAt: string
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
 * Resolves the boundary-truncated parse window for a source item (resource-minimal): a **note** slices
 * its already-loaded `content` in memory; a **file** does a bounded S3 range read (never the whole
 * object). Throws (caller maps to 422, no token spent) when the source is ineligible/unreadable — a
 * non-text type, a `file` without a `.txt`/`.md` name, or a missing/failed S3 object. Re-validates text
 * eligibility server-side; never trusts the client.
 */
export async function getSourceText(item: ParseSourceItem): Promise<SourceTextResult> {
  if (item.itemTypeName === 'note') {
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

/** Lists eligible text `file` items for the "Select from my files" picker (IDOR-scoped). */
export async function listParseSourceCandidates(userId: string): Promise<ParseSourceCandidate[]> {
  const rows = await prisma.item.findMany({
    where: {
      userId,
      itemType: { name: 'file' },
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

/** IDOR-scoped: only returns the job when it belongs to the session user. */
export async function getParseJobSnapshot(userId: string, jobId: string): Promise<ParseJobSnapshot | null> {
  const job = await prisma.aiParseJob.findFirst({
    where: { id: jobId, userId },
    select: {
      status: true,
      progress: true,
      error: true,
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
  return {
    status: job.status as ParseJobStatus,
    progress: job.progress,
    error: job.error,
    collectionName: job.collectionName,
    collectionIds: job.collectionIds,
    sourceItemId: job.sourceItemId,
    sourceItemType: job.sourceItem?.itemType.name ?? null,
    sourceName: job.sourceName,
    truncated: job.truncated,
    items: job.items,
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

/** Lists jobs awaiting review (in-progress or completed with committable drafts) for badge + /parse index. */
export async function listActiveParseJobs(userId: string): Promise<ParseJobSummary[]> {
  const jobs = await prisma.aiParseJob.findMany({
    where: {
      userId,
      OR: [
        { status: 'processing' },
        { status: 'completed', items: { some: { trashed: false } } },
      ],
    },
    select: {
      id: true,
      status: true,
      progress: true,
      sourceName: true,
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
    createdAt: job.createdAt.toISOString(),
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
    if (cursor !== null) {
      await prisma.$transaction(async (tx) => {
        await tx.aiParseJob.updateMany({ where: { id: jobId, userId }, data: { streamCursor: cursor } })
      })
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

export async function finishJob(
  userId: string,
  jobId: string,
  status: Extract<ParseJobStatus, 'completed' | 'failed'>,
  error?: string,
  // Set when the run ended `incomplete` (OpenAI `max_output_tokens`): the job is terminal-completed but
  // its tail was never parsed, so we reuse the `truncated` flag to disclose the partial result.
  truncated?: boolean,
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
  log.info({ userId, jobId, status, truncated: Boolean(truncated) }, 'parse job finished')
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
 */
async function resolveJobCollectionIds(userId: string, jobId: string): Promise<string[] | null> {
  const job = await prisma.aiParseJob.findFirst({
    where: { id: jobId, userId },
    select: { collectionName: true, collectionIds: true },
  })
  if (!job) return null

  const newName = job.collectionName?.trim()
  if (!newName) return job.collectionIds

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
 * Shared commit core for per-item "Save now" (one draft) and batch "Save all" (a job's drafts):
 * creates a real item from each draft sequentially — keeps log/connection pressure bounded and order
 * deterministic — attaching the already-resolved collection target, then **immediately deletes that
 * draft** so a crash mid-batch can only ever leave the single in-flight draft re-committable (never the
 * whole batch) and a retry resumes from where it stopped. A failed `createItem` keeps its draft (not
 * deleted, not counted) so the user can retry it. Returns how many items were actually created.
 * Residual: the create+delete of one draft isn't a single transaction (`createItem` owns its own
 * writes), so a crash in that narrow window can duplicate at most one item on retry — an accepted bound.
 */
async function commitDrafts(userId: string, collectionIds: string[], drafts: ParseDraftItemDTO[]): Promise<number> {
  let created = 0
  for (const draft of drafts) {
    const item = await createItem(userId, draftToItemInput(draft, collectionIds))
    if (!item) continue // createItem failed — keep the draft so the user can retry.
    await prisma.aiParseJobItem.deleteMany({ where: { id: draft.id, userId } })
    created += 1
  }
  return created
}

/**
 * Commits a single draft into a real item (per-item "Save now"), attaching it to the job's resolved
 * collection target — the same union the batch commit uses. `commitDrafts` creates the item then deletes
 * that draft (the job and its other drafts survive). IDOR-scoped: returns null when the draft isn't the
 * user's or is trashed. Spends no AI budget. Returns 1 when created, 0 when createItem failed (draft kept).
 */
export async function commitDraftItem(userId: string, jobId: string, itemId: string): Promise<number | null> {
  const draft = await prisma.aiParseJobItem.findFirst({
    where: { id: itemId, jobId, userId, trashed: false },
    select: DRAFT_SELECT,
  })
  if (!draft) return null

  const collectionIds = (await resolveJobCollectionIds(userId, jobId)) ?? []
  const created = await commitDrafts(userId, collectionIds, [draft])
  if (created === 0) return 0 // createItem failed — commitDrafts kept the draft so the user can retry.

  log.info({ userId, jobId, itemId, collections: collectionIds.length }, 'parse draft committed')
  return created
}

export type CommitJobResult =
  | { kind: 'not_found' }
  | { kind: 'still_processing' }
  | { kind: 'done'; created: number; total: number }

/**
 * Commits every draft of a job into real items via `createItem`, then deletes the job (cascading its
 * drafts). IDOR-scoped. Spends no AI budget. The caller invalidates the items cache.
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

  // Resolve the commit-time collection target (existing ids + a once-created new collection), shared
  // with per-item "Save now" so the two paths never create duplicate collections. `createItem`
  // re-validates each id against the user, so the stored existing ids are IDOR-safe at attach time.
  const targetCollectionIds = (await resolveJobCollectionIds(userId, jobId)) ?? []

  const created = await commitDrafts(userId, targetCollectionIds, job.items)

  // Remove the job (discarding any trashed drafts) only when every committable draft was saved —
  // commitDrafts already deleted each committed draft. On a partial failure the failed drafts remain,
  // so we keep the job for the user to retry rather than deleting (and losing) them.
  if (created === job.items.length) {
    await prisma.aiParseJob.deleteMany({ where: { id: jobId, userId } })
  }
  log.info({ userId, jobId, created, total: job.items.length, collections: targetCollectionIds.length }, 'parse job committed')
  return { kind: 'done', created, total: job.items.length }
}
