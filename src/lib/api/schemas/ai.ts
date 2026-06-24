import { z } from 'zod'
import { itemAiFileMetadataSchema, trimOptionalAiField } from '@/lib/ai/item-context'
import {
  SPLIT_FILE_MIN_INPUT_CHARS,
  SPLIT_FILE_MAX_PASTE_BYTES,
  SPLIT_FILE_TITLE_MAX_CHARS,
  ITEM_DESCRIPTION_MAX_CHARS,
  COLLECTION_NAME_MAX_CHARS,
} from '@/lib/utils/constants'

// Request/response schemas for the AI endpoints (oRPC `oc.route()` wrappers stripped — bare Zod).
// The inputs keep their `.transform()` (trim/clamp) + `.refine()` (require some signal) so the route
// handler's parse normalizes and validates exactly as the contract did. [C].
//
// `itemType` is `z.string()` (not the system-type enum): item type is modeled as a free string
// across the app (SYSTEM_TYPE_ORDER is `string[]`), it only flavors the AI prompt (not a
// security/Pro boundary), and a plain string keeps the generated client type aligned with the app's
// uniform `string` typing instead of a stricter codegen-only literal union.

const DESCRIPTION_MAX_INPUT_CHARS = 6000
const TAGS_MAX_INPUT_CHARS = 4000

export const generateDescriptionInput = z
  .object({
    itemType: z.string(),
    itemId: z.string().optional(),
    title: z.string().optional(),
    content: z.string().optional(),
    url: z.string().optional(),
    language: z.string().optional(),
    fileName: z.string().optional(),
    ...itemAiFileMetadataSchema,
  })
  .transform((data) => ({
    itemType: data.itemType,
    itemId: data.itemId,
    title: trimOptionalAiField(data.title, DESCRIPTION_MAX_INPUT_CHARS),
    content: trimOptionalAiField(data.content, DESCRIPTION_MAX_INPUT_CHARS),
    url: trimOptionalAiField(data.url, DESCRIPTION_MAX_INPUT_CHARS),
    language: trimOptionalAiField(data.language, 100),
    fileName: trimOptionalAiField(data.fileName, 255),
    fileSize: data.fileSize,
  }))
  .refine(
    (data) => Boolean(data.title || data.content || data.url || data.fileName),
    { message: 'Provide a title, content, URL, or file name to generate a description.' },
  )

export const generateTagsInput = z
  .object({
    itemType: z.string(),
    itemId: z.string().optional(),
    title: z.string().optional(),
    content: z.string().optional(),
    fileName: z.string().optional(),
    ...itemAiFileMetadataSchema,
  })
  .transform((data) => ({
    itemType: data.itemType,
    itemId: data.itemId,
    title: trimOptionalAiField(data.title, TAGS_MAX_INPUT_CHARS),
    content: trimOptionalAiField(data.content, TAGS_MAX_INPUT_CHARS),
    fileName: trimOptionalAiField(data.fileName, 255),
    fileSize: data.fileSize,
  }))
  .refine((data) => Boolean(data.title || data.fileName), {
    message: 'Provide a title or file name to suggest tags.',
  })

export const generateCollectionDescriptionInput = z
  .object({ name: z.string() })
  .transform((data) => ({ name: data.name.trim().slice(0, COLLECTION_NAME_MAX_CHARS) }))
  .refine((data) => data.name.length > 0, { message: 'Collection name is required' })

// Explain a code item the user already owns: only the item id is sent — the route reads the
// canonical content/language/type from the DB (scoped to the session userId), so the client never
// re-uploads the code and the server never trusts client-supplied content.
export const explainCodeInput = z.object({
  itemId: z.string().trim().min(1),
})

// Optimize a prompt the user already owns: only the item id is sent — the route reads the canonical
// content from the DB (scoped to the session userId), so the client never re-uploads the prompt and
// the server never trusts client-supplied content.
export const optimizePromptInput = z.object({
  itemId: z.string().trim().min(1),
})

// Shared `{ description }` response — reused by item + collection description, so `.meta({ id })`
// emits a single $ref component.
export const aiDescriptionOutput = z.object({ description: z.string() }).meta({ id: 'AiDescription' })

export const aiExplanationOutput = z.object({ explanation: z.string() }).meta({ id: 'AiExplanation' })

export const aiOptimizedPromptOutput = z.object({ prompt: z.string() }).meta({ id: 'AiOptimizedPrompt' })

export const aiTagsOutput = z.array(z.string())

// Read-only AI usage meter payload — one entry per AI feature bucket (browser-safe; the rate-limit
// keys live in the server-only `rate-limit.ts`, so the key is a plain string here). `resetAt` is an
// epoch-ms timestamp; `0` means full budget / nothing counting down.
const aiFeatureUsageSchema = z.object({
  key: z.string(),
  limit: z.number(),
  remaining: z.number(),
  resetAt: z.number(),
})

// `features` = the four 1:1 per-feature meters; `brainDump` is the Brain Dump quota, surfaced
// separately (its `aiBrainDump` key is intentionally NOT in AI_RATE_LIMIT_KEYS, so it never joins the
// 4-up grid). Both come from the non-consuming `getRemaining` read and fail open.
export const aiUsageOutput = z
  .object({ features: z.array(aiFeatureUsageSchema), brainDump: aiFeatureUsageSchema })
  .meta({ id: 'AiUsage' })

// ── AI File Splitter ("Brain Dump") ──────────────────────────────────────────────────────────────

// v1 create payload — exactly one of:
//   • `text` (paste): the **full** pasted text, NOT clamped (the server stores it whole as a `note` and
//     slices the 50k parse window itself). Bounded by SPLIT_FILE_MAX_PASTE_BYTES (~1 MB) so the note
//     stays under the platform request-body limit — over it is a 422 with "upload as a file" guidance.
//   • `sourceItemId` (upload/select): an existing `file`/`note` item to reuse; the server re-validates
//     ownership + text eligibility before reading it.
export const brainDumpInput = z
  .object({
    text: z.string().optional(),
    sourceItemId: z.string().trim().min(1).optional(),
  })
  // Presence-based (not truthiness): an empty-string `text` is still "provided" and must fail the
  // one-of, so a stray `{ text: '', sourceItemId }` can't slip through as a sourceItemId-only request.
  .refine((data) => (data.text !== undefined) !== (data.sourceItemId !== undefined), {
    message: 'Provide exactly one of text (paste) or sourceItemId.',
  })
  // Char-length short-circuit: chars <= bytes always, so if char length exceeds the byte cap, the byte length
  // definitely does, allowing us to reject early without allocating an encoded copy of a huge body to measure it.
  .refine(
    (data) =>
      data.text === undefined ||
      (data.text.length <= SPLIT_FILE_MAX_PASTE_BYTES &&
        new TextEncoder().encode(data.text).length <= SPLIT_FILE_MAX_PASTE_BYTES),
    { message: 'This paste is very large — upload it as a file instead.' },
  )
  .refine(
    (data) => data.text === undefined || data.text.replace(/\s/g, '').length >= SPLIT_FILE_MIN_INPUT_CHARS,
    { message: `Provide at least ${SPLIT_FILE_MIN_INPUT_CHARS} characters of text to split.` },
  )

// One draft item on the review board. `itemTypeName` is the bucket; the editable fields mirror the
// columns of `AiParseJobItem`. Shared by the snapshot + SSE `item` event payloads.
export const brainDumpDraftItemSchema = z
  .object({
    id: z.string(),
    order: z.number(),
    itemTypeName: z.string(),
    title: z.string(),
    content: z.string().nullable().optional(),
    url: z.string().nullable().optional(),
    language: z.string().nullable().optional(),
    description: z.string().nullable().optional(),
    tags: z.array(z.string()),
    // true when the draft sits in the board's Trash bucket (soft-deleted; excluded from commit).
    trashed: z.boolean(),
    // Advisory de-dup: the committed stash item this draft appears to duplicate (id for the deep-link,
    // title for the badge), or null when unique. Computed server-side on the snapshot read; the card
    // shows a non-blocking "possible duplicate" badge. Never blocks commit.
    duplicateOf: z
      .object({ id: z.string(), title: z.string(), itemTypeName: z.string() })
      .nullable()
      .optional(),
  })
  .meta({ id: 'BrainDumpDraftItem' })

// POST /ai/brain-dump → the created job id (+ source label / parse-window truncation for the toast).
export const brainDumpJobCreatedSchema = z
  .object({
    jobId: z.string(),
    sourceName: z.string().nullable(),
    // The parse window was boundary-truncated (the stored source is still full) — drives the toast notice.
    truncated: z.boolean(),
  })
  .meta({ id: 'BrainDumpJobCreated' })

// GET /ai/brain-dump/{jobId} → the full DB snapshot used to seed/resume the board on (re)connect.
export const brainDumpJobSnapshotSchema = z
  .object({
    // `closed` (post-commit history stub) drives the board's read-only History mode (Trash bucket only).
    status: z.enum(['processing', 'completed', 'failed', 'closed']),
    progress: z.number(),
    error: z.string().nullable().optional(),
    // Closed-job stub stats (null/absent for in-review jobs): total committed + per-type breakdown, shown
    // in the History banner.
    committedCount: z.number().optional(),
    committedByType: z.record(z.string(), z.number()).nullable().optional(),
    // Commit-time collection target: a new-collection name (default from source name) + existing ids.
    collectionName: z.string().nullable(),
    collectionIds: z.array(z.string()),
    // v1 source persistence — for the review header's source deep-link + parse-window truncation notice.
    // `sourceItemId`/`sourceItemType` are null if the user deleted the source item (onDelete: SetNull).
    sourceItemId: z.string().nullable(),
    sourceItemType: z.string().nullable(),
    sourceName: z.string().nullable(),
    truncated: z.boolean(),
    items: z.array(brainDumpDraftItemSchema),
  })
  .meta({ id: 'BrainDumpJobSnapshot' })

// GET /ai/brain-dump/sources?type= → which durable stash items the picker lists: eligible text
// `file`s ("My files") or `brain-dump`-tagged content items ("Items"). Defaults to `file`.
export const brainDumpSourceQuery = z.object({
  type: z.enum(['file', 'content']).default('file'),
})

// GET /ai/brain-dump/sources → an eligible source item for the "Select from my stash" picker.
export const brainDumpSourceSchema = z
  .object({ itemId: z.string(), name: z.string(), itemTypeName: z.string(), sizeBytes: z.number().nullable() })
  .meta({ id: 'BrainDumpSource' })

export const brainDumpSourceListSchema = z.object({ sources: z.array(brainDumpSourceSchema) }).meta({ id: 'BrainDumpSourceList' })

// PATCH /ai/brain-dump/{jobId} — set the commit-time collection target. Both optional; at least one.
export const brainDumpJobCollectionsInput = z
  .object({
    collectionName: z.string().max(COLLECTION_NAME_MAX_CHARS).nullable().optional(),
    collectionIds: z.array(z.string()).max(50).optional(),
  })
  .refine((data) => Object.keys(data).length > 0, { message: 'No fields to update.' })

// PATCH a draft: re-classify (drag → bucket), re-order, or edit fields. All optional; at least one.
// `itemTypeName` is constrained to the five text buckets the board exposes — `file`/`image` need an
// uploaded binary, so a draft can never be reclassified into one and committed as a broken item.
export const brainDumpItemPatchInput = z
  .object({
    itemTypeName: z.enum(['snippet', 'command', 'prompt', 'note', 'link']).optional(),
    order: z.number().optional(),
    title: z.string().min(1).max(SPLIT_FILE_TITLE_MAX_CHARS).optional(),
    content: z.string().nullable().optional(),
    url: z.string().nullable().optional(),
    language: z.string().nullable().optional(),
    description: z.string().max(ITEM_DESCRIPTION_MAX_CHARS).nullable().optional(),
    tags: z.array(z.string()).max(5).optional(),
    // Soft-delete toggle: true → Trash bucket, false → restore.
    trashed: z.boolean().optional(),
  })
  .refine((data) => Object.keys(data).length > 0, { message: 'No fields to update.' })

// POST /ai/brain-dump/{jobId}/commit ("Save all") → items created + whether the job was demoted to the
// `closed` history stub (every committable draft saved). `closed` drives the dashboard redirect + toast.
export const brainDumpCommitOutput = z
  .object({ created: z.number(), total: z.number(), closed: z.boolean() })
  .meta({ id: 'BrainDumpCommit' })

// POST /ai/brain-dump/{jobId}/items/{itemId}/commit body — per-item "Save now". `confirmCreateCollection`
// gates the silent auto-creation of the job's pending new collection: the per-item path shows a confirm
// dialog first, and only re-POSTs with the flag true once the user accepts (cancel commits with no
// collection). Absent/false on a job with no pending new collection → no-op (nothing to create).
export const brainDumpItemCommitInput = z
  .object({ confirmCreateCollection: z.boolean().optional() })
  .meta({ id: 'BrainDumpItemCommitInput' })

// POST /ai/brain-dump/{jobId}/items/{itemId}/commit → items created (0 or 1), whether this commit
// auto-closed the job (last committable draft) for the dashboard redirect, and whether the commit needs
// the user to confirm creating the job's pending new collection before it can attach it.
export const brainDumpItemCommitOutput = z
  .object({
    created: z.number(),
    autoClosed: z.boolean(),
    // True when the commit was held back pending collection-create confirmation (the item was NOT saved
    // yet); the client shows the dialog then re-POSTs with `confirmCreateCollection: true`.
    needsCollectionConfirm: z.boolean(),
  })
  .meta({ id: 'BrainDumpItemCommit' })

// GET /ai/brain-dump → the user's in-progress jobs (entry-card badge + /parse index). The status enum
// includes `closed` because the same summary shape feeds the History list (GET ?history=1).
export const brainDumpJobSummarySchema = z
  .object({
    id: z.string(),
    status: z.enum(['processing', 'completed', 'failed', 'closed']),
    progress: z.number(),
    itemCount: z.number(),
    sourceName: z.string().nullable(),
    // The job's commit-time "New collection" name (defaults to the source filename, user-editable). The
    // list card prefers it over `sourceName` so the card label matches the collection the items will join.
    collectionName: z.string().nullable(),
    createdAt: z.string(),
    // Closed-job history stub stats (null/absent on active jobs): total committed + per-type breakdown.
    committedCount: z.number().optional(),
    committedByType: z.record(z.string(), z.number()).nullable().optional(),
  })
  .meta({ id: 'BrainDumpJobSummary' })

export const brainDumpJobListSchema = z.object({ jobs: z.array(brainDumpJobSummarySchema) }).meta({ id: 'BrainDumpJobList' })

// GET /ai/brain-dump?history=1 → the History list (closed jobs) instead of the active list. Absent →
// active jobs (processing/completed/failed with committable drafts). Query params arrive as strings;
// map the literal '1'/'true' explicitly (mirrors `downloadQueryParse` — never `z.coerce.boolean`, which
// would turn 'false'/'0' into true).
export const brainDumpListQuery = z.object({
  history: z
    .enum(['1', 'true', '0', 'false'])
    .optional()
    .transform((v) => v === '1' || v === 'true'),
})

// Path params for the per-job and per-draft split routes.
export const brainDumpJobIdParam = z.object({ jobId: z.string().trim().min(1, 'Job is required.') })
export type BrainDumpJobIdParam = z.infer<typeof brainDumpJobIdParam>
export const brainDumpItemParams = z.object({ jobId: z.string().min(1), itemId: z.string().min(1) })
export type BrainDumpItemParams = z.infer<typeof brainDumpItemParams>
