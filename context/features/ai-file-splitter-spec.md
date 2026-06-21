# Feature Spec: Brain Dump (AI File-to-Items Splitter)

## 1. Summary
Invert DevStash's one-at-a-time item creation: a Pro user uploads/pastes one long project text file →
AI streams it back **split into many draft items of the correct type** (snippet/command/prompt/note/
link), each with all applicable fields prefilled → the user reviews them on a dedicated `/parse/[jobId]`
page (Bento masonry buckets), drags cards between buckets to reclassify, edits via a drawer, and
**commits them as real items** in one batch (or per-item). Heavy AI op → **Pro-only, rate-limited to
1 *new* Brain Dump / hour / user** (resume and concurrent jobs are unrestricted).

## 2. Status
Single source of truth for what exists vs. what's planned. Tiered detail lives in §11 (Planned work).

### Built — `feature/ai-file-splitter`
Full vertical slice: background-mode streaming/resume + Bento review board.
- **Core** — data model + squashed migration `20260621121518_ai_parse_jobs`, `aiSplitFile` rate-limit
  key, Zod schemas, splitter, DB helpers, routes, hooks, board, entry card, `/parse` index, sidebar link.
- **Trash bucket** — soft delete → restore / delete-forever / empty; drag-in trashes, drag-out restores
  + reclassifies; excluded from commit.
- **Commit-time collection target** — new collection seeded from the source name (editable/clearable)
  and/or attach existing collections; items join the union.
- **Verified green:** `lint`, `tsc`, `test:run` (957), `migrate status`, `openapi:gen`.
- **Pending:** Playwright happy-path + merge.

### Built — v1 (this branch)
Source persistence as durable stash items (paste → **`note`**, upload/select → **`file`**; all tagged
`brain-dump`); 3-source entry (upload / select-from-files / paste) with persistence + OpenAI-retention
notices; gate-first source creation; bounded S3 range read (`getTextFromS3`); discard-whole-job
(`DELETE …/[jobId]`, best-effort `responses.cancel` when processing); AI-Usage Brain Dump card +
`/ai/usage` `splitFile` quota. Source columns folded into `20260621121518_ai_parse_jobs` and applied
additively on **dev**.

**Deviations from the spec text (code is authoritative):**
- **Source link is a real item deep-link**, not a drawer-from-anywhere or a tag-filter page — those
  routes don't exist. Added `GET /api/items/{id}` + an `ItemDeepLink` opener on `/items/[type]` that
  reads `?item=<id>`. The §11.2 "find by `brain-dump` tag" hint is **informational text only** (a stash
  tag-filter route is a separate, out-of-scope feature).
- **Ordering:** for `sourceItemId` the source is read + eligibility-validated **before** the 1/hr
  rate-limit (unreadable → 422, token unspent); a paste note is created **after** the rate-limit gate.
- `getTextFromS3`'s bounded range read is kept, but its "multi-GB" framing is moot — `FILE_MAX_BYTES`
  caps uploads at 10 MB.

### Planned (spec'd, not coded)
- **v1.5** — Re-parse; cancel a running job; job label in lists/header.
- **v2** — merge/aggregate review across jobs; de-dup vs stash; bulk board actions; parse-from-Files;
  abandoned-job TTL cleanup; source provenance.
- **v3** — Live item type change among the text-compatible types (snippet/prompt/command/note) +
  strict type/language boundaries (distinct command vs snippet language sets; AI classification
  tightened). Spans the live-item edit flow, **not** the parse pipeline — its own feature/branch.

Prototype: `prototypes/ai-file/index.html` (tabbed; 10 explored layouts, Bento selected as default —
the other 9 are not built).

## 3. Problem
Every item is created singly through `item-create-dialog`. A user who keeps a long file about one
project (notes + snippets + commands + links jumbled together) has no fast path to get it in. This
feature reads that file with AI and produces reviewable, pre-classified drafts to commit in bulk.

## 4. Architecture & locked decisions
All Context7-verified for the installed versions (latest re-verify 2026-06); each decision appears once
here, not repeated below.

- **Buckets = the 7 item types** (`snippet` · `prompt` · `command` · `note` · `link` · `file` ·
  `image`). Dragging a card reclassifies its `itemTypeName` before commit. The AI only emits
  text-derived types; `file`/`image` exist as drop targets, not auto-populated from text.
- **Full coverage — lose nothing.** Every meaningful passage becomes an item; anything unclassifiable
  becomes a **`note`** (catch-all). Only pure visual structure (separators/blank lines) is dropped;
  heading text folds into the item it labels. `parseSplitLine()` mirrors this (unknown/missing type →
  `note`, missing title synthesized from content, only truly-empty objects skipped; blank/malformed
  *stream* lines skipped as artifacts, never as lost source). Full prompt: `ai-file-splitter-prompt.md`.
- **Resume engine = OpenAI Responses background mode.** `responses.create({ background: true,
  store: true, stream: true, max_output_tokens: 8000 })` runs generation **on OpenAI's servers,
  decoupled from our request**, surviving `maxDuration=60` / tab-close / refresh. The model emits **one
  compact JSON object per line (JSONL)**; we buffer `response.output_text.delta`, split on `\n`,
  Zod-validate each line, and record each clean-boundary event's `sequence_number` as the resume cursor.
  **Drafts and that cursor are persisted together in one atomic transaction** (§7.4), so the cursor never
  runs ahead of or behind the saved drafts. **Resume** replays from the exact cursor (no duplication, no
  re-generation, no extra token). The request's `AbortSignal` detaches our reader **without** cancelling
  the upstream run.
  - **Context7 note (openai-node):** OpenAI now documents the resume helper as
    `client.responses.stream(responseId, { starting_after: cursor })`; the repo currently uses the
    equivalent `client.responses.retrieve(responseId, { stream: true, starting_after })` — both hit
    `GET /responses/{id}?stream=true&starting_after=N`. ⚠ Re-verify this typing against the installed
    `openai-node` on each upgrade; migrate to `responses.stream(...)` if the helper stabilizes.
    Cancel (v1.5) = `client.responses.cancel(responseId)` — idempotent, **background-only** (REST
    `POST /responses/{id}/cancel`; retrieve/resume is `GET /responses/{id}` — both Context7-verified).
- **Context7 note (Prisma 7):** the boundary persist (§7.4 `appendDraftsAndAdvance`) uses an
  **interactive transaction** `prisma.$transaction(async (tx) => …)` — the documented Prisma pattern for
  committing multiple writes atomically; supported by the `@prisma/adapter-neon` driver adapter. This is
  the canonical fix for the resume-duplication window; re-verify the adapter still implements
  `startTransaction` on each Prisma/adapter upgrade.
- **Bento Buckets (dynamic masonry) — locked UX.** One box per type; each grows with its count (no
  fixed height/cap/internal scroll — all cards visible) and the boxes pack Pinterest-style. Built with
  **CSS columns** + **Motion** `layout` + `AnimatePresence mode="popLayout"` + `layoutScroll` so
  insert/grow/remove animate smoothly. Receiving bucket flashes a border-beam; cards pop in.
- **Drag-and-drop = `@dnd-kit/react` + `@dnd-kit/helpers`** (React-19 API: `DragDropProvider` /
  `useSortable({id,index,group,type,accept})` / `move(items, event)` / `isSortable(source)`). **Not**
  legacy `@dnd-kit/core`/`DndContext`, **not** `react-grid-layout`.
  - **Context7 note (@dnd-kit/react):** the canonical multi-list pattern reflows **live in
    `onDragOver`** via `setItems((items) => move(items, event))` and persists the final placement in
    `onDragEnd`; guard with `isSortable(source)` and skip column-vs-item collisions via
    `source.type === 'column'`. Our board keeps the optimistic local update + revert on PATCH failure.
- **Hybrid commit.** Primary **"Save all N"** (non-trashed only) + per-item **"Save item now"**. Both
  map `draft → createItem` (`commitJob` handles 1 or N) and **spend no AI budget** — only the initial
  split consumes the hourly token.
- **Stack conventions.** Client reads/mutations via `$api`/`api` (`@/lib/api/client`) only — never
  `fetch`/Server Actions; new endpoint = `route.ts` + `paths.ts` + Zod schema, then
  `npm run openapi:gen` (no hand-edited `openapi.json`/`src/types/openapi.ts`). Zod 4 `.meta({ id })`
  for `$ref`s. `userId` always from session (IDOR-safe).

## 5. User flow
1. **Entry** (dashboard AI-Usage card, the `/parse` index, or the sidebar link) — Pro-only. Choose a
   source: **Upload from device**, **Select from my files** *(v1)*, or **Paste**. Client validates
   length → `POST /ai/split-file` → `{ jobId }` → `router.push('/parse/' + jobId)`. *(v1: the route gates
   Pro + quota **first**; for paste it then persists the note source, for upload/select it references the
   `file` item already created via the existing file-upload flow, before creating the job — §11.1.)*
2. **Review** `/parse/[jobId]` (Pro-gated) — replays the DB snapshot, then streams a fresh run live, or
   (if interrupted and still `processing`) shows a **"Resume parsing"** button:
   - **Progress header** — status, live "N items found" `NumberTicker`, `Progress` bar,
     `animated-shiny-text` while streaming.
   - **Bento board** — draft cards pop into their type bucket; buckets grow + reflow; receiving bucket
     flashes a border-beam. A **Trash** bucket holds soft-deleted drafts.
   - **Collection target** above the board (new-collection name + `CollectionSelector`).
   - **Per card** — prefilled fields + preview; inline title edit; **Save now** / **Delete** (→ Trash);
     click opens the **editable draft drawer** (full type-specific form).
   - User drags between buckets to reclassify, edits, trashes/restores, may Save individual items.
3. **Commit** — **"Save all"** → `POST /ai/split-file/[jobId]/commit` → one real `Item` per non-trashed
   draft (via `createItem`), applies the collection target, deletes the job + drafts, **redirects to
   `/parse`** with a toast.

## 6. Data model (Prisma — staging tables; squashed migration `20260621121518_ai_parse_jobs`)
Conventions: cuid PK, `userId` FK `onDelete: Cascade`, `createdAt`/`updatedAt`, `@@map` snake_case.
Migrate via `prisma migrate dev` on the **`dev`** Neon branch only. Rows are deleted on commit/discard.

- **`AiParseJob`** (`ai_parse_jobs`) — *as built:* `id`, `status` (`processing|completed|failed`),
  `progress` (0–100), `sourceText` (`@db.Text` — per-job working copy fed to OpenAI; deleted with the
  job), `error?`, `openaiResponseId?` (background handle for resume), `streamCursor?` (`Int` — last
  consumed `sequence_number`), `collectionName?` + `collectionIds String[] @default([])` (commit-time
  target), timestamps, `userId`, `items[]`. `@@index([userId, createdAt])` + `@@index([userId, status])`
  (powers the in-progress list). **Resumable** iff `status='processing'` && `openaiResponseId` set.
  - **Planned (v1):** `sourceItemId?` + `sourceItem? Item @relation(onDelete: SetNull)` (durable source
    item — a **`note`** for paste or a **`file`** for upload/select; see §11.1), `sourceName?` (display
    label), `truncated?` (the **parse window** was boundary-truncated because the source exceeded
    `SPLIT_FILE_MAX_INPUT_CHARS`; the stored source item itself is always full). **Re-parsable** iff
    `sourceItemId` set.
- **`AiParseJobItem`** (`ai_parse_job_items`) — *as built:* `id`, `order`, `itemTypeName` (the bucket),
  `title`, `content?` (`@db.Text`), `url?`, `language?`, `description?` (`@db.Text`), `tags String[]`,
  `trashed Boolean @default(false)` (soft delete → Trash bucket; excluded from commit), `createdAt`,
  `jobId`, `userId` (denormalized for IDOR-safe direct queries). `@@index([jobId])` + `@@index([userId])`.

## 7. Backend
### 7.1 Rate limit (`src/lib/infra/rate-limit.ts`) — built
`aiSplitFile = { attempts: 1, window: '1 h' }`, keyed by `userId`. Consumed **only** by
`POST /ai/split-file` (and planned `POST …/re-parse`); every read/edit endpoint must not. Enforcement
fails closed; the usage meter fails open. **`aiSplitFile` is intentionally NOT in `AI_RATE_LIMIT_KEYS`**
(`['aiOptimize','aiExplain','aiTags','aiDescription']` — the 4-up usage grid maps 1:1); the Brain Dump
quota is surfaced separately (see §8, §11.1).

### 7.2 Schemas (`src/lib/api/schemas/ai.ts`, browser-safe Zod, `.meta({ id })`) — built
- `splitFileInput` `{ text, fileName? }` — trims, clamps `text` to 50k chars, min 20 non-blank;
  `fileName` seeds the default new-collection name.
- `splitDraftItemSchema` `{ id, order, itemTypeName, title, content?, url?, language?, description?,
  tags, trashed }`.
- `splitJobSnapshotSchema` `{ status, progress, error?, collectionName, collectionIds, items[] }`
  (note: `resumable` is **derived** in the SSE/hook layer, not a snapshot field).
- `splitJobSummarySchema` `{ id, status, progress, itemCount, createdAt }` (`itemCount` = non-trashed).
- `splitJobCreatedSchema` `{ jobId }`; `splitJobListSchema` `{ jobs }`.
- `splitJobCollectionsInput` `{ collectionName?, collectionIds? }` (≥1 required).
- `splitItemPatchInput` `{ itemTypeName?, order?, title?, content?, url?, language?, description?, tags?,
  trashed? }` (≥1 required).
- `splitCommitOutput` `{ created }`.
- **Planned (v1):** `splitFileInput` becomes a `.refine`d one-of `{ sourceItemId } | { text }`. For
  `text` (paste) the v1 schema **drops the 50k clamp** (the note is saved full) but caps length at
  `SPLIT_FILE_MAX_PASTE_BYTES` (~1 MB) → over-cap is a `422` with "upload as a file instead" (the 50k
  parse window is sliced server-side, after persisting). `text` → server creates a `note` source;
  `sourceItemId` → reuse an existing file/note (server **re-validates ownership + text eligibility**
  before reading, IDOR-safe). Both yield `job.sourceItemId`. Snapshot/summary add `sourceName?` (+
  snapshot `truncated?`); new `splitSourceFile` `{ itemId, name, sizeBytes }` + `splitSourceList`.

### 7.3 Splitter (`src/lib/ai/split-file.ts`) — built
`SPLIT_SYSTEM_PROMPT` + `buildSplitUserMessage(text)`; `parseSplitLine(line)` (tolerant parse +
per-type normalization + Zod → `SplitDraft | null`); `splitFileProgress(count)` (shared 0–95 progress
formula, reused by the route + DB helper); `startBackgroundSplit(client, sourceText, signal)` (creates
the background run; returns the stream), `resumeBackgroundSplit(client, responseId, startingAfter,
signal)` (reconnects via `starting_after`), `consumeSplitStream(stream, handlers, log)` where
`handlers = { startOrder, onResponseId, onFlush(drafts, startOrder, cursor) }` → `{ status, emitted }`.
The stream buffers `response.output_text.delta` and flushes **per clean line boundary** (only when the
buffer fully drains to empty): each `onFlush` receives the batch of complete drafts **plus that
boundary's `sequence_number` cursor** (or `null` for the terminal trailing flush), so persistence and
the cursor advance commit together (§7.4). Drafts that never reach a boundary before a non-terminal
detach are **dropped, not persisted** — they regenerate on resume, so a crash can never leave a draft
ahead of the cursor (no duplication, no loss). Consumed events: `response.output_text.delta` (buffer →
flush each complete line, record `sequence_number`), `…done` (flush tail), `response.completed`
(finalize), `response.failed`/`error` (fail).

### 7.4 DB helpers (`src/lib/db/ai-parse-jobs.ts`, `server-only`, no `'use cache'`, all IDOR-scoped) — built
`createParseJob`, `getParseJobSnapshot`, `getParseJobRunState`, `listActiveParseJobs`,
`setOpenAiResponseId`, `updateStreamCursor`, `appendDraftsAndAdvance`, `finishJob`,
`updateJobCollections`, `patchDraftItem`, `deleteDraftItem`, `emptyJobTrash`, `commitDraftItem`
(per-item "Save now" → one `createItem`), `commitJob` (maps non-trashed drafts → `createItem`,
creates/attaches collections, deletes the job).
- **`appendDraftsAndAdvance(userId, jobId, drafts, startOrder, cursor)`** is the stream persist path:
  it writes the boundary's drafts, the `streamCursor`, and `progress` in **one
  `prisma.$transaction` interactive transaction** so they commit atomically (an empty batch with a
  non-null cursor just advances the cursor). This is the Context7-verified Prisma pattern for atomic
  multi-write — it **replaces** the earlier two-write `appendDraftItem` + `updateStreamCursor`/
  `updateJobProgress` sequence, whose gap between the draft insert and the cursor update was the
  resume-duplication crash window. `updateStreamCursor` is retained (used internally by the helper for
  the empty-batch cursor-only advance).
- **Planned (v1):** `deleteJob` (discard), a source-list helper, and `getSourceText(item)` (note
  `content` or `getTextFromS3`; consume the S3 stream **once** and save the result). `createParseJob` —
  invoked **only after** the POST route's Pro + 1/hr gates pass — creates/links the **full** source item
  (note for paste, file for upload/select) tagged `brain-dump`, then slices the boundary-truncated parse
  window into `sourceText` (no orphan source if the request is refused).

### 7.5 Routes (`authedRoute*` + `paths.ts` + `openapi:gen`; params are awaited `Promise`s)
| Route | Method(s) | Status | Consumes token |
|---|---|---|---|
| `/ai/split-file` | `POST` (create) / `GET` (in-progress list) | built | POST only |
| `/ai/split-file/[jobId]` | `GET` (snapshot) / `PATCH` (collection target) | built | no |
| `/ai/split-file/[jobId]/stream` | `GET` (SSE; fresh run or resume via `?resume=1`) | built | no |
| `/ai/split-file/[jobId]/items/[itemId]` | `PATCH` (edit / `trashed` toggle) / `DELETE` (delete-forever) | built | no |
| `/ai/split-file/[jobId]/items/[itemId]/commit` | `POST` (save one draft as a real item now) | built | no |
| `/ai/split-file/[jobId]/trash` | `DELETE` (empty trash) | built | no |
| `/ai/split-file/[jobId]/commit` | `POST` | built | no |
| `/ai/split-file/sources` | `GET` (eligible text file items for the picker) | **built (v1)** | no |
| `/ai/split-file/[jobId]` | `DELETE` (discard job — keep the source item; cancel run if processing) | **built (v1)** | no |
| `/items/{id}` | `GET` (single item — powers the source deep-link drawer) | **built (v1)** | no |
| `/ai/split-file/[jobId]/re-parse` | `POST` (new job from the same `sourceItemId`) | **v1.5** | yes |

### 7.6 SSE route specifics (`…/stream/route.ts`) — built
`export const maxDuration = 60`, **Node runtime** (default; OpenAI SDK + Prisma need Node). **No
`dynamic='force-dynamic'`** (incompatible with this project's `cacheComponents`; the route is already
dynamic). `ReadableStream` with `Content-Type: text/event-stream`, `Cache-Control: no-cache,
no-transform`, `Connection: keep-alive`; events framed `event: <type>\ndata: <json>\n\n`
(`snapshot`/`item`/`progress`/`resumable`/`done`/`error`). On connect: replay snapshot → if not
`processing` finish; else start fresh (no `openaiResponseId` && 0 items) or, on `?resume=1`, resume from
`streamCursor`. **Redis single-flight lock** per `jobId` (`split-lock:<jobId>`, `nx ex:70`); released in
`finally` — the 70 s TTL is the crash safety net; **`after()` is intentionally NOT used**, to avoid a
cross-request lock-delete race. `request.signal` aborts **only our reader**; the background run keeps
going so the job stays resumable.

## 8. Frontend
- **Dashboard surface = the AI Usage widget** (`src/components/dashboard/ai-usage-widget.tsx`) — Brain
  Dump is important but infrequent, so **no standalone dashboard card**. A **full-width Brain Dump card
  beneath the four AI meters** *(v1)* is the on-dashboard home: quota ("1 Brain Dump/hr" remaining + renew,
  same `NumberTicker`/popover treatment), live "N in progress" (from `useActiveSplitJobs`), and CTAs
  (`New Brain Dump` → `/parse`; `Resume` → most-recent processing job when any). **Quota plumbing (v1):**
  since `aiSplitFile` is not in `AI_RATE_LIMIT_KEYS`, extend `/ai/usage` with a separate `splitFile`
  `{ limit, remaining, resetAt }` via the non-consuming `getRemaining` (fails open) so the 4 `features[]`
  stay intact. Discovery also via the sidebar **"Brain Dump"** link + the entry-card badge.
- **Entry** (`src/components/parse/brain-dump-card.tsx`, Pro-only) — *built:* Upload from device + Paste,
  live char counter + inline validation (§9). *v1:* **three tooltipped source options** (Upload → `file`,
  Select from my files via `GET /ai/split-file/sources`, Paste → `note`), on **both** the dashboard card
  and `/parse`; an inline **persistence notice** ("saved to your stash, tagged `brain-dump`" — §11.2).
  "N in progress" badge → `/parse`.
- **`/parse` index** (`src/app/(app)/parse/page.tsx`) — `BrainDumpCard` + `parse-job-list.tsx`
  (in-progress jobs: item count + status + progress, linking to each `/parse/[jobId]`). Same data feeds
  the dashboard badge.
- **Review page** (`src/app/(app)/parse/[jobId]/page.tsx`) — auth from the `(app)` layout +
  `getCachedVerifiedProAccess`; snapshot replay on mount; **"Resume parsing"** button while
  `processing`; fetches collections to seed `parse-collection-target.tsx`. *v1:* the header shows a
  **link to the saved source item** + the `brain-dump` find-it hint (§11.2).
- **Board** (`src/components/parse/parse-review-board.tsx`) — `@dnd-kit/react` `DragDropProvider`;
  buckets are droppable groups, cards `useSortable`; cross-bucket moves reflow in `onDragOver` (`move`)
  and persist in `onDragEnd` (reclassify / trash / restore) via `usePatchDraftItem` with optimistic
  local update + revert. CSS-columns masonry + Motion `layout`/`AnimatePresence popLayout`/`layoutScroll`.
  Buckets are `BucketColumn` (header icon/color + count + Trash "Empty") rendered inline. `parse-draft-
  card.tsx` = pop-in card (drag handle, type icon, preview, tags, inline edit, Save-now/Delete/Restore,
  opens the edit `Sheet` drawer). `parse-progress.tsx` = header. Item-type icon/color via `ItemTypeIcon`.
  All chrome `motion-safe:`.
- **Hooks** (`src/hooks/use-split-file.ts`) — `useSplitFileStream(jobId)` opens an `EventSource`
  (same-origin, cookie rides along), listens via named events, exposes `applyPatch`/`removeItem`/`resume`
  + `{ items, status, progress, error, resumable, isStreaming }`; `useActiveSplitJobs` (`$api.useQuery`,
  polls 4 s while any job is `processing`); `useCreateSplitJob`, `usePatchDraftItem`, `useDeleteDraftItem`,
  `useEmptyTrash`, `useUpdateJobCollections`, `useCommitDraftItem` (per-item "Save now"),
  `useCommitSplitJob` wrap the typed `api` client (the
  create/commit calls carry a justified `no-restricted-syntax` disable — `aiSplitFile` is not in the
  usage meter and commit spends no AI). The board holds bucket state and does optimistic updates against
  the stream's local item list.
- **Magic UI** — `number-ticker` already vendored; vendor `animated-shiny-text` (+ `border-beam` if
  absent) via `npx shadcn@latest add @magicui/<slug>`, eslint-disabled per file.

## 9. Entry validation & truncation UX
Validate early, inline, helpfully — never a silent failure or cut. Client validates; server backstops.
Constants in `src/lib/utils/constants.ts`: `SPLIT_FILE_MAX_INPUT_CHARS = 50_000`,
`SPLIT_FILE_MIN_INPUT_CHARS = 20`, `SPLIT_FILE_MAX_ITEMS = 100`,
`SPLIT_FILE_ALLOWED_EXTS = new Set(['txt', 'md'])`; *(v1)* `SPLIT_FILE_MAX_PASTE_BYTES = 1 * 1024 * 1024`
(~1 MB paste body cap). (`SPLIT_FILE_MAX_BYTES = 512 * 1024` is **built-path only** — the current
FileReader upload rejects over 512 KB; **v1 drops it** for the normal Pro file-upload limit, see below.)

- **Unified rule (v1) — store full, parse a window.** Both sources are persisted **whole, never
  truncated** (upload → `file` item; paste → `note` item; §11.1), then read back via `getSourceText`.
  Only the **parse window** is bounded: if the decoded source exceeds `SPLIT_FILE_MAX_INPUT_CHARS`
  (50,000), the server **boundary-truncates** it (prefer the last `\n\n` before 50k, else last `\n`, else
  a hard cut), sets `truncated = true`, and the UI **explicitly notifies** the user — at entry, in the
  post-create toast, and on the review header. **Never a silent cut**; the stored source keeps every
  character. Split stays **enabled** (the cut is expected, not an error).
- **Live counter** — upload/paste shows progress toward the **50,000-char parse window**
  (`SPLIT_FILE_MAX_INPUT_CHARS`; neutral → amber at ≥ 90 % → red over) with a persistent "full source is
  saved" reassurance.
- **File upload reuses the existing file-item flow (v1)** — "Upload from device" is **not** a
  brain-dump-specific upload; it goes through the **existing file-item creation flow** (`POST /api/upload/url`
  → presigned POST → `uploadToPresignedPost` (XHR) → `createItem` type `file`), producing a **permanent
  `file` item visible in the Files tab**. That flow already Pro-gates, rate-limits (`uploadUrl`), validates
  **extension + size server-side** (`ALLOWED_FILE_EXTS` / `FILE_MAX_BYTES`), and tracks/sweeps abandoned
  uploads (`writePendingUpload` / `sweepExpiredUploads`) — so there is **no brain-dump-specific presign and
  no new orphan class** (a refused or abandoned upload is the existing flow's already-handled pending
  upload, not a brain-dump leak). Brain-dump adds only: the **entry filters the picker to `.txt`/`.md`** for
  UX, and the **backend re-validates text eligibility** of the chosen `sourceItemId` at parse time before
  the bounded S3 range read (§11.1). Only the first 50k chars feed the AI.
  - *Built path (FileReader, pre-v1):* `accept=".txt,.md"` + `file.size > 512 KB` inline errors before
    reading; v1 replaces it with the existing file-upload flow above (normal Pro limit, no brain-dump byte cap).
- **Paste size cap (v1)** — paste is bounded by `SPLIT_FILE_MAX_PASTE_BYTES` (~1 MB), **client + server**;
  over it → inline error *"This paste is very large — upload it as a file instead"* (Split disabled) and a
  hard `422` server-side. **Reject-with-guidance, not truncation** (accepted notes are still saved full):
  it keeps the note under the platform request-body limit, which would otherwise buffer only a **partial
  body and silently clip** the note (Context7: Next.js `proxyClientMaxBodySize` default 10 MB / Vercel
  ~4.5 MB serverless body cap). Bigger sources belong on the file path (browser → S3, no body limit).
- **Over the parse window** (source > 50,000 chars, **either** upload or paste) — inline notice + tooltip
  *"Your full source is saved — only the first 50,000 characters are parsed into items."*; the parse runs
  on the boundary-truncated window; **Split stays enabled**, no hard-`422` on overage. (The built
  FileReader path instead offered a *"Use first 50,000 characters"* action that filled the textarea and
  disabled Split while over; v1 replaces that block with the auto-truncate-and-notify above.)
- **Below minimum** `< 20` non-blank chars → Split disabled + hint.
- **Server backstop** — gates run **first** (Pro → 403, 1/hr → 429) so a refused request never persists a
  source item; then the route persists the **full** source item and slices only `sourceText` to
  `SPLIT_FILE_MAX_INPUT_CHARS` (boundary-aware, defense in depth) with `truncated` set when it bit.
- **Guidance not dead-ends** — over-limit copy nudges pruning boilerplate; auto-truncation is the fast path.

## 10. Resume & resilience
Generation runs in **background mode**, decoupled from our SSE request, so the **persisted drafts** and
the **upstream run** both survive refresh/tab-close/network-drop/`maxDuration`. Flow: (1) returning
replays the DB snapshot; (2) if still `processing`, a manual **"Resume parsing"** button (explicit, not
auto) reconnects via `starting_after: streamCursor` and continues from the exact cursor — no
duplication, no token; (3) if the run finished while away, resume fetches the final response, persists
items past the cursor, marks `completed`. A **Redis single-flight lock per `jobId`** prevents two tabs
streaming the same job. **Multiple distinct jobs** may run at once (each its own response); only a *new*
job consumes the hourly token. On stream error → `status='failed'` + message, partial drafts retained;
commit is idempotent (deletes the draft).

## 11. Planned work
Consolidated detail for the tiers in §2. Each capability lists its tier inline.

### 11.1 Source persistence as durable stash items — v1
**Every** parse source is persisted as a real, taggable `Item` — created the **existing `createItem`
way** — that **lives in the user's stash independently of the job**, so no source is ephemeral, every
job is re-parsable, and prior sources are **findable + re-applicable** later. The persisted item's
**type depends on how the source arrived**:

1. **Upload from device** → a **`file` item** created through the **existing file-item upload flow**
   (`POST /api/upload/url` presign → direct browser → S3 → `createItem` type `file`), stored **whole and
   untruncated** under the **normal Pro file-upload size limit**. It is a **permanent stash item visible in
   the Files tab** from the moment it's created — brain-dump does not own its lifecycle. The app server
   never streams the bytes; the existing flow's server-side ext/size checks (`ALLOWED_FILE_EXTS` /
   `FILE_MAX_BYTES`), `uploadUrl` Pro-gated limiter, and pending-upload sweep (`writePendingUpload` /
   `sweepExpiredUploads`) all apply unchanged — **no brain-dump-specific presign, no new orphan class**.
   Brain-dump's only additions: the entry filters the picker to `.txt`/`.md`, and the backend
   **re-validates text eligibility** of the referenced item before reading its text back **on demand at
   parse time** (bounded S3 range read — see *Read at parse time*).
2. **Select from my files** → an **existing text `file` item** (no new upload); the job just references it.
3. **Paste** → a **`note` item** (NOT a `file`). The **full** pasted text is sent **in the POST body**
   (browser → backend, no S3) and stored as its `content` (`@db.Text`, uncapped, never truncated); title
   from the first line / `brain-dump-<timestamp>`. Created via `createItem` type `note`. Because the full
   text is already in the request, the backend slices the **first `SPLIT_FILE_MAX_INPUT_CHARS` (50,000)**
   chars **in memory** into `sourceText` (§9, §11.2) — **no re-read, no second transfer**. The note keeps
   everything; only the parse uses the window.

**Transport asymmetry (drives the optimization):** a paste's full text necessarily transits the POST body
once (so the note can be stored whole) — the parse window is then a free in-memory slice. A file never
transits the app server on upload; it must be **fetched back from S3** to parse, so that read is the one
to optimize (bounded range, below).

The job records the chosen item as **`sourceItemId`** — always set at creation, nullable in schema only
so `onDelete: SetNull` fires if the user later deletes the source item (job/drafts survive; re-parse
then disabled). `sourceText` stays the per-job working copy. **Gate-first:** `POST /ai/split-file` checks
Pro (403) and the 1/hr limit (429) **before** it creates the paste **note** or the job, so a refused paste
never leaves an orphan note. For **upload / select**, the `file` item already exists as an intentional
stash item (created by the existing file-upload flow, which has its own Pro gate + pending-upload sweep) —
the parse route only **references** it, so a refused parse simply leaves the user's file untouched, never
an orphan.

- **Tagging for discovery + re-apply** — every persisted source item is tagged with a reserved
  **`brain-dump`** tag (new constant in `src/lib/utils/constants.ts`, e.g. `BRAIN_DUMP_SOURCE_TAG`), so
  the user can **filter their stash to find brain-dump sources** and re-apply parsing (v1.5 re-parse on
  the job; v2 "Parse from the stash" on the item). Any user-meaningful name flows into the item title.
- **Read at parse time (resource-minimal)** — `getSourceText(item)` returns the parse-window text by
  item type, fetching **as little as possible**:
  - a **note** → `item.content` is already in the row; slice the first `SPLIT_FILE_MAX_INPUT_CHARS`
    in-memory. No S3, no extra I/O.
  - a **file** → a **bounded range read** of S3, never the whole object: `getTextFromS3(key, maxChars)`
    issues `GetObjectCommand({ Range: 'bytes=0-{N-1}' })` where `N` covers the char window
    (`SPLIT_FILE_MAX_INPUT_CHARS × 4`, the worst-case UTF-8 bytes/char). **No HEAD/size probe is needed** —
    a `bytes=0-…` range on a smaller object simply returns the available bytes, and the response's
    `ContentRange` carries the full size for `truncated` detection (one request, not two). Then
    `Body.transformToString('utf-8')` — consume the stream **exactly once** and save the result (an
    unconsumed body leaks the socket; the body can't be re-read — Context7-verified AWS SDK v3); text is
    assumed **UTF-8** (non-UTF-8 degrades gracefully to replacement chars, tolerated by the parser). A
    multi-gigabyte stored file therefore costs only a ≲ 200 KB pull, one decode, and a small buffer — no
    full download into RAM. The decoded string is boundary-sliced to the char window (dropping any partial
    trailing multi-byte char left by the byte cut).
  Either path enforces the 20-non-blank-min and **boundary-truncates to `SPLIT_FILE_MAX_INPUT_CHARS`**
  when longer, storing the result as `sourceText`. The streaming/resume engine is unchanged.
- **Over-cap detection & `truncated`** — for a **note**, `content.length > SPLIT_FILE_MAX_INPUT_CHARS`.
  For a **file**, the range response's `ContentRange`/`ContentLength` reveals the object is larger than the
  bytes pulled (or the decoded window already fills the char cap) → set `truncated = true` without a
  second request. **Both** sources are saved at **full length** and never truncated in storage; only the
  **parse window** is bounded — boundary-truncated (`\n\n` → `\n` → hard), disclosed inline + on the
  review header (§11.2), so the user is never silently cut, whether the source is a `file` or a paste `note`.
- **Eligibility & source validation** — the picker shows only text **file** items (`.txt`/`.md` or
  `text/*` mime); prior paste **notes** are re-parsed via re-parse / the `brain-dump` tag. The server
  **re-validates** any client-supplied `sourceItemId` (ownership — IDOR-safe — **and** text eligibility)
  **before** reading S3, never trusting the client. If a source can't be read as text — deleted/missing
  S3 object, ineligible/binary type, or an S3 error — **job creation fails at the boundary**
  (`422`/conflict): **no job is created, the hourly token is not spent, and the source item is
  untouched**; the user picks another source and retries.
- **Lifecycle decoupling** — discarding a job deletes job + drafts + `sourceText` but **keeps the
  source item**; deleting that item is the separate existing stash action.

### 11.2 Persistence transparency (notify + link + find) — v1
Because the source is **saved to the user's stash by design** (not ephemeral), the UI must be explicit
about it — never a silent write:
- **Before** — the entry card discloses it inline, near the existing "sent to OpenAI" note, e.g. *"Your
  source is saved to your stash (tagged `brain-dump`) so you can re-parse it later."* Tooltipped for
  detail; one short line, not a modal.
- **After creation** — surface a **link to the saved source item** (the `note` or `file`) on the review
  page header (and a confirmation toast), plus a **find-it-later hint**: *"Saved as *project-notes.md* —
  find your sources anytime by the `brain-dump` tag."* The hint links to the stash filtered by that tag
  (the existing items/tag filter route). The source link uses `sourceName` + the item's normal detail
  surface.
- **Parse-window notice (paste)** — when pasted text exceeds the parse window, the entry **explicitly**
  states the split: *"Your full note is saved; the first 50,000 characters are parsed into items."* This is
  a hard requirement, **not a silent truncation** — shown inline at entry, echoed in the post-create toast,
  and on the review header (alongside the source link). It reassures that nothing is lost from the note
  while being honest that the parse covered only the window (re-parse / manual item creation cover the rest).
- **Discoverability** — the reserved `brain-dump` tag is the durable handle: applied to every source
  item, shown on the source link, and the target of the find hint, the `/items` tag filter, and the v2
  "Parse from the stash" action. Surfaced consistently so the user learns one mechanism.

### 11.3 Capability roadmap
| Capability | Tier | Notes |
|---|---|---|
| **Trash bucket** (soft delete/restore/empty) | **built** | `trashed` flag; reuses item PATCH + `/trash` DELETE |
| **Commit-time collection target** | **built** | new-from-name + existing; union; `commitJob` realizes it |
| **Source persistence as stash items** | **v1** | §11.1 — paste → `note` (full text saved; parse window = first `SPLIT_FILE_MAX_INPUT_CHARS` = 50k), upload/select → `file`; all tagged `brain-dump`; durable → re-parsable + findable |
| **Persistence notice + source link** | **v1** | §11.2 — entry discloses "your source is saved"; after creation, link to the source item + a "find later by the `brain-dump` tag" hint |
| **Select source from my files** | **v1** | `GET /ai/split-file/sources` picker (text `file` items; paste notes via tag/re-parse) |
| **Discard a pending/in-progress job** | **v1** | `DELETE …/[jobId]`; deletes drafts + `sourceText`, **keeps the source item**; cancels the run if processing; confirm + tooltip |
| **Tolerant + tooltipped workflow** | **v1** | tooltips on every non-obvious affordance; confirm on discard; soft-delete-with-restore; no silent failures; Base UI `Tooltip` (+ the touch `Popover` pattern from `ai-usage-widget.tsx`) |
| **Re-parse any job** | **v1.5** | `POST …/re-parse` re-reads `sourceItemId` → new job; **consumes a fresh token** |
| **Cancel a running job** | **v1.5** | `client.responses.cancel(openaiResponseId)` (idempotent, background-only) then discard |
| **Job label** | **v1.5** | `sourceName` in `/parse` index, badge tooltip, review header (distinguishes concurrent jobs) |
| **Parse from the stash** | **v2** | "Parse with Brain Dump" action on a text `file`/`note` item (find prior sources by the `brain-dump` tag) |
| **Merge / aggregate review across jobs** | **v2** | one board over several jobs; multi-job commit (cross-job DnD — heavy) |
| **De-dup vs the existing stash** | **v2** | flag drafts that duplicate saved items |
| **Bulk board actions** | **v2** | multi-select → bulk move/delete/save; "Save all in this bucket" |
| **Abandoned-job TTL cleanup (24 h)** | **v2** | TTL/cron; manual Discard reduces urgency |
| **Source provenance** | **v2** | line-numbered input → per-item `sourceLines`/`sourceQuote`; client highlights deterministically; "Source" peek in the drawer |
| **Strict type/language boundaries** | **v3** | §11.4 — distinct command vs snippet language sets; picker filters by type; AI prompt + `parseSplitLine` use the language set as a classification disambiguator |
| **Live item type change** | **v3** | §11.4 — `itemTypeName` patchable on `PATCH /items/{id}`, constrained to the text-compatible set; best-effort language remap; confirm only on language loss (optimistic apply + Undo toast, not a blocking modal) |

### 11.4 Live item type change + strict type/language boundaries — v3
A standalone follow-up that hardens the snippet/command distinction (today purely cosmetic — same
`content` column, same Monaco language list, free-text `language`) and lets a user **re-type an
already-committed item** between the four text-compatible types. **Own feature/branch**, separate from
the parse pipeline; the AI-prompt half also improves the existing splitter, so it may land first.

- **Strict language sets** (`src/lib/utils/constants.ts`) — `COMMAND_LANGUAGES` = curated shell/CLI set
  (`bash`, `sh`, `zsh`, `fish`, `powershell`, `bat`/`cmd`, `dockerfile`, `makefile`); **snippet** offers
  the **full Monaco language list minus `COMMAND_LANGUAGES`** (computed in `useMonacoLanguageList`, no
  hand-maintained list). `LanguageInput` (`src/components/shared/item-content-input.tsx`) filters its
  dropdown by the item type.
- **Soft validation** — picker + AI are the enforcement; the server `language` column stays free-text
  (no Zod allow-list, no migration, no rejection of legacy out-of-set values). `language` is display
  metadata, not security-sensitive.
- **AI classification tightening** (`SPLIT_SYSTEM_PROMPT` + `parseSplitLine` in `src/lib/ai/split-file.ts`;
  mirror in `ai-file-splitter-prompt.md`) — snippet `language` ∈ programming (never shell); command
  `language` ∈ shell/CLI only; tie-breaker *"runnable in a terminal → command; source you'd paste into a
  file → snippet."* `parseSplitLine` uses the language set as a **disambiguator**: a `snippet` carrying a
  shell language normalizes to `command` (and vice versa), instead of blindly trusting `itemTypeName`.
- **Live type change** — `itemTypeName` becomes patchable on `PATCH /items/{id}`
  (`itemMutationSchema`/`src/lib/utils/validators.ts`), constrained **server-side** to the
  text-compatible set `{snippet, prompt, command, note}`. `link` is **excluded** (lossy — it would flip
  `contentType` TEXT↔URL and require moving/inventing `url`). The handler resolves the new system
  `ItemType` and patches `itemTypeId`; `contentType` stays `TEXT`; `content`/`description`/`tags`/
  collections are untouched. No Pro concern (all four are free types). On any switch touching
  snippet/command, `remapLanguageForType(language, targetType)` does a **best-effort remap** (e.g.
  `shell`/`sh`/`zsh` → `bash` snippet→command) and **clears** when no sensible mapping exists.
- **UI control** — a type switcher at the **top** of the drawer edit content
  (`item-drawer-edit-content.tsx`) so it reads top-down (type governs which fields render). A **controlled
  Base UI `Select`** (`value`/`onValueChange` — the seam to intercept a switch before applying), options
  **restricted to the four text types** with `ItemTypeIcon` + label; `file`/`image`/`link` are **not
  rendered** (their absence *is* the boundary — no disabled-with-tooltip needed). The form already derives
  per-type inputs, so the language picker (and code editor vs markdown) re-derive on switch — language
  shows only for snippet/command; icon/color update immediately. *(Context7-verified Base UI `Select.Root`
  controlled `value`/`onValueChange`.)*
- **UX — confirm only on real loss; prefer Undo over a blocking modal.** A type change here is **fully
  reversible and low-stakes** — no `content` is touched; the only possible loss is `language` cleared (or
  best-effort remapped). So:
  - **Lossless switches apply immediately, no prompt** — prompt↔note (no language either side), and
    snippet↔command where `remapLanguageForType` returns a value. Don't nag.
  - **Lossy switch (language would be cleared:** snippet/command → prompt/note with a language set, or a
    snippet↔command remap that returns `null`) — apply **optimistically** via the existing item PATCH +
    cache updater, then a **toast with Undo** that restores the prior `itemTypeName` + `language` (matches
    the project's optimistic-update + revert convention). Toast copy is **specific**: *"Changed to Note —
    language 'python' cleared. Undo."*
  - **Blocking `AlertDialog` is the fallback, not the default**, used only if a switch is later deemed
    must-confirm; even then it is the **neutral** variant (Cancel reverts because the controlled `Select`
    `value` still holds the old type), **never** the destructive-red `AlertDialogAction` (nothing is
    destroyed). Driven by a controlled `AlertDialog.Root open` set from `onValueChange`.
  *(Context7: shadcn reserves the destructive `AlertDialog` for irreversible deletes; reversible metadata
  changes use optimistic apply + Undo.)*
- **Tests** — `remapLanguageForType` (remap hits + null→clear); the `PATCH /items/{id}` type-change path +
  allow-list rejection of non-text targets (incl. `link`); `parseSplitLine` language-disambiguation cases.
  (Undo/toast/Select are component-level → out of the server/util test scope, per §13.)

## 12. Non-functional requirements
**Access & quota** — Pro-only (route does its own `isPro` check → `403`); 1 Brain Dump/hr (`aiSplitFile`,
Upstash sliding window, keyed by `userId`); only `POST /ai/split-file` (+ planned re-parse) consumes;
over-limit → `429` + `Retry-After`; fails closed (meter fails open). **Resume and concurrent jobs spend no
new token** and are bounded by the 1/hr *new-job* cap, so no separate resume/concurrency limiter is
warranted (accepted non-risk — resume reconnects to an already-running background response). **Persisted
sources are ordinary stash items** (`note`/`file`), so they count against the user's normal item count and
Pro file-storage quota — there is **no separate brain-dump quota**, and at-limit behavior is the existing
item/upload-limit behavior (the file path inherits it directly via the reused upload flow).

**Input limits** — **parse window** `SPLIT_FILE_MAX_INPUT_CHARS = 50_000` applies to **both** sources:
each source item is **stored whole** (a `file`'s S3 object as-is; a paste `note`'s `content` is
`@db.Text`, uncapped) and only the **first 50,000 chars** are parsed — boundary-truncated, `truncated`
set, disclosed and never silent (§9/§11.2); the parse path does **not** hard-`422` on overage. Min 20
non-blank; sources = device upload → `file` item (bytes go browser → S3, never the app server), selected
text `file` item (`getTextFromS3`), or paste → `note` (full text in the POST body); binary/rich formats
out of scope. **Device uploads reuse the existing file-item upload flow** (v1 drops the built path's 512 KB
`SPLIT_FILE_MAX_BYTES` brain-dump cap) — its server-side ext/size validation (`ALLOWED_FILE_EXTS` /
`FILE_MAX_BYTES`), `uploadUrl` Pro-gated limiter, and pending-upload sweep apply unchanged; the file
becomes a permanent stash item and brain-dump only reads its text back at parse time after re-validating
eligibility (§9, §11.1). **Paste
body cap** `SPLIT_FILE_MAX_PASTE_BYTES` (~1 MB), client + server, **rejected (`422`) over it** with
"upload as a file" guidance — a reject (never a silent clip), keeping the note under the platform
request-body limit; larger content uses the file path. **Gate-first:** Pro (403) + 1/hr (429) are checked
**before** the source item/job are created, so a refused request never orphans a source. **Max 100
items/job** (server stops persisting past the cap, logs it); per-item field caps reuse the existing item
limits (tags ≤ 5); `max_output_tokens: 8000` bounds cost/latency to the item cap.

**Resource efficiency** — the read path is sized to consume the minimum network/RAM/CPU: a paste note's
parse window is a free **in-memory** slice of the already-received POST body (no re-read); a file is
fetched with a **bounded S3 range GET** (`Range: bytes=0-N`, `N ≈ parse-window chars × 4`; **no HEAD/size
probe** — a `0-N` range on a smaller object returns just the available bytes) and decoded **once**, so
even a multi-GB stored file costs a ≲ 200 KB pull and a small buffer — never a full download. `truncated`
is derived from the range response's `ContentRange`/`ContentLength` (no extra request). No source bytes
are buffered on the app server during upload (direct browser → S3) — and the paste body cap bounds the
one place text does transit the app (the POST body).

**Performance** — model `gpt-5-mini` (repo `DEFAULT`) via background `responses.create`; first item
< ~3 s, full run 10–30 s, p95 < 45 s; SSE `maxDuration=60` (stop gracefully, mark complete-with-partial,
never hang); one atomic DB write per clean line boundary (drafts + cursor + progress together, not per
token); 100-item cap keeps the board un-virtualized;
polling fallback ~1 s when `EventSource` is unavailable.

**Reliability** — refresh-safe (persist before emit; snapshot replay); true resume (background mode +
`streamCursor`); multiple concurrent jobs; single-flight Redis lock; idempotent commit (deletes the
draft); on stream error → `status='failed'` + message, partial drafts retained.

**Security / privacy / retention** — `userId` from session; every query IDOR-scoped; all inputs
Zod-validated. A client-supplied `sourceItemId` is **re-validated server-side** (ownership + text
eligibility) before any S3 read — never trust the client; an unreadable/ineligible source **fails at
creation** without spending the token. Uploads reuse the existing file-item flow (its Pro-gated `uploadUrl`
presign, server-side ext/size validation, and pending-upload sweep), so brain-dump introduces **no new
direct-upload surface to secure**; text eligibility is enforced server-side at parse time. The **paste
body cap** (`SPLIT_FILE_MAX_PASTE_BYTES`) bounds per-request memory (anti-DoS) and keeps the note under
the platform body limit so it is never silently clipped. `sourceText` (plaintext) deleted on commit **or
discard**; the persisted **source item**
(`note` for paste, `file` for upload/select) follows the normal stash lifecycle (kept on discard,
removed only via the user's stash delete + its S3 cleanup for files). Because the source is **kept by
design**, the entry must **disclose persistence** and the result must **link to the saved source** with
a find-it-later hint (§11.2). Abandoned jobs purged after 24 h (v2). Text is sent to **OpenAI (third
party)** and, because background mode requires `store: true`, the **response is retained at OpenAI** — the
stored response persists **~30 days** (retrievable / visible in dashboard logs) and background mode also
writes response data to disk **~10 min** for polling; this is **not Zero-Data-Retention compatible**
(Context7-verified, developers.openai.com). **Disclose this at the entry** (alongside the existing "sent to
OpenAI" note) with a **tooltip** spelling out the retention, like existing AI features. No server-side
cache of this per-user dynamic data.

**Observability** — `logger.child({ tag: 'ai-split-file-stream' })` etc.; native Pino shape
(`log.info({ ids }, 'event')`, `Error` as `{ err }`); log job created, stream start/detach, completion
(count + duration), rate-limit hits, failures. No per-token noise.

**Accessibility** — drag has a keyboard-accessible alternative (the drawer's type select); `@dnd-kit`
keyboard sensor + live-region announcements; type by **icon + label**, not color alone; all motion
`motion-safe:` (respects `prefers-reduced-motion`).

## 13. Tests (Vitest — server/util only; no component tests)
- `src/lib/ai/split-file.test.ts` — `parseSplitLine` (valid/blank/incomplete/fenced; per-type
  normalization: link requires url, content dropped for file/link, tags lowercased/deduped/≤5);
  `consumeSplitStream` flushes each draft batch with its boundary `sequence_number` cursor, holds the
  tail, and **drops boundary-less drafts on a non-terminal detach** (regression guard: no dup on
  resume); **(v1)** file-source cap/boundary-truncation sets `truncated`, and `getTextFromS3` issues a
  **bounded `Range` GET** sized to the parse window + decodes once (mock the S3 client: assert the
  `Range`/`maxChars` bound and that the whole object is never requested; derive `truncated` from a mocked
  `ContentRange`; no real S3).
- `src/lib/db/ai-parse-jobs.test.ts` — `commitJob` mapping + per-type fields + **trashed excluded** +
  **collection create/attach**; `commitDraftItem` per-item save; `appendDraftsAndAdvance` writes drafts +
  cursor + progress in one transaction (atomic, empty-batch cursor-only advance); IDOR on
  `getParseJobSnapshot`/`listActiveParseJobs`; `updateStreamCursor` monotonic; `setOpenAiResponseId`;
  `emptyJobTrash`/`updateJobCollections` clamp + IDOR; **(v1)**
  `deleteJob` removes job+drafts+`sourceText` but leaves the **source item** (`SetNull`); paste creates a
  `note` source whose `content` holds the **full** text while `sourceText` is the **first
  `SPLIT_FILE_MAX_INPUT_CHARS`** slice (parse-window truncation), upload creates a `file` source, both
  tagged `brain-dump`; source-list filters to text file items + IDOR.
- `src/lib/api/schemas/ai.test.ts` — **(v1)** `splitFileInput` accepts exactly one of
  `{ text }`/`{ sourceItemId }`; `text` over `SPLIT_FILE_MAX_PASTE_BYTES` (~1 MB) invalid, while a long
  (but ≤ cap) paste is accepted **whole** (not 50k-clamped — the parse-window slice is server-side).
- `rate-limit.test.ts` — `aiSplitFile` = `{ attempts: 1, window: '1 h' }`; resume/list don't consume.
- Route test (mirrors `src/app/api/ai/ai.test.ts`) — `POST /ai/split-file` 401/403/429/201 (text **and**
  `sourceItemId`); over-cap paste → `422`; an unreadable/ineligible `sourceItemId` (not owned, binary, or
  S3 error) → `422` with **no token spent and no job created** (mock `getSourceText` to throw);
  **gate-first ordering**: a 403 (non-Pro) or 429 (2nd within the hour) creates **no** source item or job
  (assert `createItem`/`createParseJob` not called); re-parse consumes; resume/list/sources/snapshot/
  patch/delete/commit do **not** consume.

## 14. Verification
`npm run lint` + `npm run test:run`; `prisma migrate dev`/`status` on the **dev** branch;
`npm run openapi:gen` (no hand edits); Playwright happy path (upload → stream → **interrupt (close tab)
→ reopen → "Resume parsing" continues from the cursor, no duplicate drafts** → drag → edit → delete →
Save all → items exist; a 2nd in-progress job is reachable from the entry badge / `/parse`; a 2nd
*upload* within the hour → `429` while resume of an existing job still works); `npm run build`.

## 15. Out of scope (v1)
Pro-tiered limits or changing the 1/hr cap (it gates *new* jobs only — resume, concurrency, and
re-parse-as-a-new-job are unrestricted); non-text formats (PDF/docx); auto-populating `file`/`image`
buckets from text; **automatic** (non-manual) resume; component unit tests; and everything tiered **v2/v3**
in §11.3 (merge, de-dup, bulk actions, parse-from-Files, TTL cleanup, provenance; live type change +
strict type/language boundaries — §11.4). A separate standalone
dashboard card is rejected — the Brain Dump card lives in the AI Usage widget.

## 16. Reference
- Prompt artifact: `context/features/ai-file-splitter-prompt.md`
- Prototype: `prototypes/ai-file/index.html` (+ `screenshots/`)
