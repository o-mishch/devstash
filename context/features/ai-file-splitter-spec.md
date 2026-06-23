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
- **Core** — data model + squashed migration `20260621121518_ai_parse_jobs`, `aiBrainDump` rate-limit
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
`/ai/usage` `brainDump` quota. Source columns folded into `20260621121518_ai_parse_jobs` and applied
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
*(Active finalization — `context/current-feature.md`: the 4 in-scope **v2** items + all **v2.5** + both
**v3** items. **v1/v1.5** are done foundation on the stacked branch. Merge/aggregate review + source
provenance stay carved out — `brain-dump-cross-job-and-provenance-spec.md`.)*
- **v1.5** — Re-parse; cancel a running job; job label in lists/header.
- **v2** — merge/aggregate review across jobs; de-dup vs stash; bulk board actions; parse-from-Files;
  abandoned-job TTL cleanup; source provenance.
- **v3** — Live item type change among the text-compatible types (snippet/prompt/command/note) +
  strict type/language boundaries (distinct command vs snippet language sets; AI classification
  tightened). Spans the live-item edit flow, **not** the parse pipeline — its own feature/branch.
- **v2.5 (job lifecycle)** — `closed` history status on commit (kept stub + still-committable Trash);
  rich `failed` detail; OpenAI terminal-state mapping (`incomplete`/`content_filter`); list-view
  delete; per-item collection-confirm dialog; raised output budget. Detailed in §11.5.

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
  heading text folds into the item it labels. `parseBrainDumpLine()` mirrors this (unknown/missing type →
  `note`, missing title synthesized from content, only truly-empty objects skipped; blank/malformed
  *stream* lines skipped as artifacts, never as lost source). Full prompt: `ai-file-splitter-prompt.md`.
- **Resume engine = OpenAI Responses background mode.** `responses.create({ background: true,
  store: true, stream: true, max_output_tokens: 16000 })` runs generation **on OpenAI's servers,
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
  - **Atomic per-draft commit (v2.5).** Each draft's **create-live-item + delete-draft is one
    `prisma.$transaction`** so a commit either fully lands (item created, draft gone) or fully rolls back —
    never both, never neither. This **supersedes** the earlier built path (`commitDrafts`: `createItem`
    then a separate `deleteMany`), whose narrow gap between the two writes was an *accepted bound* (a crash
    there could re-create at most one item on retry). It is **per-draft** (the batch still iterates drafts
    sequentially so a partial failure keeps the un-committed drafts) — the atomicity is on the **single
    draft's** create+delete, which is exactly the duplication window.
    - **Ordering matters — delete-guards-create (kills the double-commit race).** Inside the tx, **delete the
      draft first and check it affected exactly one row**; only then create the live item. If the delete
      affects **0 rows**, another actor (a second tab's "Save all", or a concurrent per-item commit) already
      committed that draft → **skip, create nothing** (the tx is a no-op for that draft). A naive
      create-then-delete would let the second actor create a **duplicate** live item before discovering the
      draft was already gone. So the per-draft tx is `delete(draftId) → if count===0 skip → createItem(tx)`.
      No job-level commit lock is needed; the row-delete race is the single-flight guard.
    - **Shared-`createItem` refactor (the enabling change — note it's not Brain-Dump-local).** `createItem`
      (`src/lib/db/items.ts`) is shared code with **many callers beyond Brain Dump** (item-create dialog,
      other importers), so the tx plumbing must be **additive and non-breaking**. Give it an **optional last
      param** `tx?: Prisma.TransactionClient` (default → the module `prisma`), used as the db handle for its
      writes — `item.create` and the `connectOrCreate`/collection writes it already does. **Every existing
      call site stays unchanged** (the param is optional and defaults to the standalone client, preserving
      today's own-transaction behavior). Its two *reads* — `getSystemItemTypes` (cached) and
      `getValidCollectionIds` — can stay on the normal client (they're reads; pulling them into the tx only
      lengthens it), so only the **writes** move onto `tx`. `commitDrafts` then wraps `createItem(userId,
      input, tx)` + the draft `delete` in one `prisma.$transaction(async (tx) => …)`.
      *(Context7-verify the installed Prisma 7 `Prisma.TransactionClient` type + interactive-transaction
      callback signature against `@prisma/adapter-neon` before coding — same adapter the §7.4
      `appendDraftsAndAdvance` interactive transaction already relies on, so the pattern is proven here.)*
    - **Scope guard.** Touching shared `createItem` is the one v2.5 change that reaches **outside** the
      Brain Dump surface. Keep it minimal: signature-only (optional `tx`), no behavior change for existing
      callers, covered by the existing `createItem` tests plus the new atomic-commit test (§13). If the
      refactor's blast radius grows, prefer a thin `createItemTx(tx, userId, data)` wrapper over reshaping
      the public `createItem` signature.
- **Stack conventions.** Client reads/mutations via `$api`/`api` (`@/lib/api/client`) only — never
  `fetch`/Server Actions; new endpoint = `route.ts` + `paths.ts` + Zod schema, then
  `npm run openapi:gen` (no hand-edited `openapi.json`/`src/types/openapi.ts`). Zod 4 `.meta({ id })`
  for `$ref`s. `userId` always from session (IDOR-safe).

## 5. User flow
1. **Entry** (dashboard AI-Usage card, the `/parse` index, or the sidebar link) — Pro-only. Choose a
   source: **Upload from device**, **Select from my files** *(v1)*, or **Paste**. Client validates
   length → `POST /ai/brain-dump` → `{ jobId }` → `router.push('/parse/' + jobId)`. *(v1: the route gates
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
3. **Commit** — **"Save all"** → `POST /ai/brain-dump/[jobId]/commit` → one real `Item` per non-trashed
   draft (via `createItem`), applies the collection target, then *(as built)* deletes the job + drafts and
   **redirects to `/parse`** with a toast. *(v2.5, §11.5: commit **demotes the job to a `closed` history
   stub** — committed drafts deleted, trashed drafts + stub kept — and auto-close redirects to the
   **dashboard**.)*

## 6. Data model (Prisma — staging tables; squashed migration `20260621121518_ai_parse_jobs`)
Conventions: cuid PK, `userId` FK `onDelete: Cascade`, `createdAt`/`updatedAt`, `@@map` snake_case.
Migrate via `prisma migrate dev` on the **`dev`** Neon branch only. Rows are deleted on discard; on
**commit** the job is demoted to a **`closed`** history stub (v2.5, §11.5) — committed drafts deleted,
trashed drafts + the stub row kept until the user manually deletes it.

- **`AiParseJob`** (`ai_parse_jobs`) — *as built:* `id`, `status` (`processing|completed|failed`),
  `progress` (0–100), `sourceText` (`@db.Text` — per-job working copy fed to OpenAI; deleted with the
  job), `error?`, `openaiResponseId?` (background handle for resume), `streamCursor?` (`Int` — last
  consumed `sequence_number`), `collectionName?` + `collectionIds String[] @default([])` (commit-time
  target), timestamps, `userId`, `items[]`. `@@index([userId, createdAt])` + `@@index([userId, status])`
  (powers the in-progress list). **Resumable** iff `status='processing'` && `openaiResponseId` set.
  `status` is a **free-text `String`** column (not a Prisma `enum`), so adding `closed` (below) needs
  **no migration**.
  - **Planned (v1):** `sourceItemId?` + `sourceItem? Item @relation(onDelete: SetNull)` (durable source
    item — a **`note`** for paste or a **`file`** for upload/select; see §11.1), `sourceName?` (display
    label), `truncated?` (the **parse window** was boundary-truncated because the source exceeded
    `SPLIT_FILE_MAX_INPUT_CHARS`; the stored source item itself is always full). **Re-parsable** iff
    `sourceItemId` set.
  - **Planned (v2.5 — job lifecycle, §11.5):** `status` gains a 4th value **`closed`** (history stub set
    on commit; the *value* needs no migration — free-text column). New denormalized stub fields written at
    close so the record survives its drafts: `committedCount Int @default(0)` + `committedByType Json?` (a
    per-type count map, e.g. `{snippet:3,note:2}`, merged on late trash-commits) — **the `committedByType`
    `Json` column is the one v2.5 migration** (`migrate dev` on `dev`), **purely additive / no backfill**
    (nullable + defaulted; `closed` is brand-new so no existing closed rows exist — in-flight rows take
    null/0 and only matter once they close). `committedCount` is **kept (not derived from the map)** as a
    cheap queryable scalar; both are written in the **same close/commit transaction** so they can't drift.
    `error` is **repurposed** on `failed`
    to a **required rich detail** (human-readable description + reason category + emitted-count + cursor +
    remediation steps) rather than a generic string. No `cancelled` status (cancel → delete-or-`closed`
    dialog).
- **`AiParseJobItem`** (`ai_parse_job_items`) — *as built:* `id`, `order`, `itemTypeName` (the bucket),
  `title`, `content?` (`@db.Text`), `url?`, `language?`, `description?` (`@db.Text`), `tags String[]`,
  `trashed Boolean @default(false)` (soft delete → Trash bucket; excluded from commit), `createdAt`,
  `jobId`, `userId` (denormalized for IDOR-safe direct queries). `@@index([jobId])` + `@@index([userId])`.

## 7. Backend
### 7.1 Rate limit (`src/lib/infra/rate-limit.ts`) — built
`aiBrainDump = { attempts: 1, window: '1 h' }`, keyed by `userId`. Consumed **only** by
`POST /ai/brain-dump` (and planned `POST …/re-parse`); every read/edit endpoint must not. Enforcement
fails closed; the usage meter fails open. **`aiBrainDump` is intentionally NOT in `AI_RATE_LIMIT_KEYS`**
(`['aiOptimize','aiExplain','aiTags','aiDescription']` — the 4-up usage grid maps 1:1); the Brain Dump
quota is surfaced separately (see §8, §11.1).

### 7.2 Schemas (`src/lib/api/schemas/ai.ts`, browser-safe Zod, `.meta({ id })`) — built
- `brainDumpInput` `{ text, fileName? }` — trims, clamps `text` to 50k chars, min 20 non-blank;
  `fileName` seeds the default new-collection name.
- `brainDumpDraftItemSchema` `{ id, order, itemTypeName, title, content?, url?, language?, description?,
  tags, trashed }`.
- `brainDumpJobSnapshotSchema` `{ status, progress, error?, collectionName, collectionIds, items[] }`
  (note: `resumable` is **derived** in the SSE/hook layer, not a snapshot field).
- `brainDumpJobSummarySchema` `{ id, status, progress, itemCount, createdAt }` (`itemCount` = non-trashed).
- `brainDumpJobCreatedSchema` `{ jobId }`; `brainDumpJobListSchema` `{ jobs }`.
- `brainDumpJobCollectionsInput` `{ collectionName?, collectionIds? }` (≥1 required).
- `brainDumpItemPatchInput` `{ itemTypeName?, order?, title?, content?, url?, language?, description?, tags?,
  trashed? }` (≥1 required).
- `brainDumpCommitOutput` `{ created }`.
- **Planned (v1):** `brainDumpInput` becomes a `.refine`d one-of `{ sourceItemId } | { text }`. For
  `text` (paste) the v1 schema **drops the 50k clamp** (the note is saved full) but caps length at
  `SPLIT_FILE_MAX_PASTE_BYTES` (~1 MB) → over-cap is a `422` with "upload as a file instead" (the 50k
  parse window is sliced server-side, after persisting). `text` → server creates a `note` source;
  `sourceItemId` → reuse an existing file/note (server **re-validates ownership + text eligibility**
  before reading, IDOR-safe). Both yield `job.sourceItemId`. Snapshot/summary add `sourceName?` (+
  snapshot `truncated?`); new `brainDumpSourceSchema` `{ itemId, name, sizeBytes }` + `brainDumpSourceListSchema`.

### 7.3 Splitter (`src/lib/ai/brain-dump.ts`) — built
`BRAIN_DUMP_SYSTEM_PROMPT` + `buildBrainDumpUserMessage(text)`; `parseBrainDumpLine(line)` (tolerant parse +
per-type normalization + Zod → `BrainDumpDraft | null`); `brainDumpProgress(count)` (shared 0–95 progress
formula, reused by the route + DB helper); `startBackgroundBrainDump(client, sourceText, signal)` (creates
the background run; returns the stream), `resumeBackgroundBrainDump(client, responseId, startingAfter,
signal)` (reconnects via `starting_after`), `consumeBrainDumpStream(stream, handlers, log)` where
`handlers = { startOrder, onResponseId, onFlush(drafts, startOrder, cursor) }` → `{ status, emitted }`.
The stream buffers `response.output_text.delta` and flushes **per clean line boundary** (only when the
buffer fully drains to empty): each `onFlush` receives the batch of complete drafts **plus that
boundary's `sequence_number` cursor** (or `null` for the terminal trailing flush), so persistence and
the cursor advance commit together (§7.4). Drafts that never reach a boundary before a non-terminal
detach are **dropped, not persisted** — they regenerate on resume, so a crash can never leave a draft
ahead of the cursor (no duplication, no loss). Consumed events: `response.output_text.delta` (buffer →
flush each complete line, record `sequence_number`), `…done` (flush tail), `response.completed`
(finalize), `response.failed`/`error` (fail).
- **Planned (v2.5):** the consumer must **split `response.incomplete` by `incomplete_details.reason`** —
  `max_output_tokens` → an `incomplete` result the route finishes as `completed` + output-cap notice;
  `content_filter` → a distinct `filtered` result the route finishes as `failed` (§10). The `failed`
  finish writes a **rich detail** object (human-readable description first, then reason category,
  emitted-count, and cursor) instead of a hardcoded string — replacing the current `'Generation failed.'`
  / `'AI is not configured.'` literals.

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
| `/ai/brain-dump` | `POST` (create) / `GET` (in-progress list) | built | POST only |
| `/ai/brain-dump/[jobId]` | `GET` (snapshot) / `PATCH` (collection target) | built | no |
| `/ai/brain-dump/[jobId]/stream` | `GET` (SSE; fresh run or resume via `?resume=1`) | built | no |
| `/ai/brain-dump/[jobId]/items/[itemId]` | `PATCH` (edit / `trashed` toggle) / `DELETE` (delete-forever) | built | no |
| `/ai/brain-dump/[jobId]/items/[itemId]/commit` | `POST` (save one draft as a real item now) | built | no |
| `/ai/brain-dump/[jobId]/trash` | `DELETE` (empty trash) | built | no |
| `/ai/brain-dump/[jobId]/commit` | `POST` | built | no |
| `/ai/brain-dump/sources` | `GET` (eligible text file items for the picker) | **built (v1)** | no |
| `/ai/brain-dump/[jobId]` | `DELETE` (discard job — keep the source item; cancel run if processing) | **built (v1)** | no |
| `/items/{id}` | `GET` (single item — powers the source deep-link drawer) | **built (v1)** | no |
| `/ai/brain-dump/[jobId]/re-parse` | `POST` (new job from `sourceItemId`; **v2.5: rejects unless job is `completed`**) | **v1.5** (+v2.5 guard) | yes |

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
  same `NumberTicker`/popover treatment), live "N in progress" (from `useActiveBrainDumpJobs`), and CTAs
  (`New Brain Dump` → `/parse`; `Resume` → most-recent processing job when any). **Quota plumbing (v1):**
  since `aiBrainDump` is not in `AI_RATE_LIMIT_KEYS`, extend `/ai/usage` with a separate `brainDump`
  `{ limit, remaining, resetAt }` via the non-consuming `getRemaining` (fails open) so the 4 `features[]`
  stay intact. Discovery also via the sidebar **"Brain Dump"** link + the entry-card badge.
- **Entry** (`src/components/parse/brain-dump-card.tsx`, Pro-only) — *built:* Upload from device + Paste,
  live char counter + inline validation (§9). *v1:* **three tooltipped source options** (Upload → `file`,
  Select from my files via `GET /ai/brain-dump/sources`, Paste → `note`), on **both** the dashboard card
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
- **Hooks** (`src/hooks/use-brain-dump.ts`) — `useBrainDumpStream(jobId)` opens an `EventSource`
  (same-origin, cookie rides along), listens via named events, exposes `applyPatch`/`removeItem`/`resume`
  + `{ items, status, progress, error, resumable, isStreaming }`; `useActiveBrainDumpJobs` (`$api.useQuery`,
  polls 4 s while any job is `processing`); `useCreateBrainDumpJob`, `usePatchBrainDumpDraftItem`, `useDeleteBrainDumpDraftItem`,
  `useEmptyBrainDumpTrash`, `useUpdateBrainDumpJobCollections`, `useCommitBrainDumpDraftItem` (per-item "Save now"),
  `useCommitBrainDumpJob` wrap the typed `api` client (the
  create/commit calls carry a justified `no-restricted-syntax` disable — `aiBrainDump` is not in the
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

**Status model (4 states) — `processing` owns interruption; `failed` ⟺ not-resumable.** Interruption
(tab-close / timeout / network) is **not** a status: the job **stays `processing`** with `openaiResponseId`
+ `streamCursor` intact and is **resumable** — resumability is *derived* (`processing` && `openaiResponseId`),
surfaced as the "Resume parsing" button, never folded into `failed`. `failed` is reserved for a genuine,
**not-resumable** error and carries **required rich detail** (§7.3). `completed` = in review (drafts staged,
awaiting commit). **`closed`** (v2.5, §11.5) = post-commit history stub.

**OpenAI terminal-state mapping (Context7-verified — Responses runs end `completed|failed|incomplete|cancelled`,
a richer set than the repo's statuses).** The stream consumer already returns a distinct `incomplete`
signal; the route maps the four OpenAI outcomes **asymmetrically**:
- `completed` → `completed`.
- `incomplete` + `incomplete_details.reason === 'max_output_tokens'` (hit the output budget / item cap) →
  **`completed`** + an **output-cap data-loss notice** ("AI stopped at the item limit — later source wasn't
  parsed; re-parse / add manually for the rest"). A successful **partial**, *not* a failure. Already wired
  (the consumer returns `incomplete`; the route finishes `completed` with the truncation flag).
- `incomplete` + `incomplete_details.reason === 'content_filter'` (safety halted mid-run) → **`failed`** with
  the filter reason in the rich detail; the partial drafts that arrived **stay committable** (consistent with
  all failed-partial handling). **Net-new:** the consumer currently lumps *all* `response.incomplete` into one
  bucket — it must read `incomplete_details.reason` and branch token-cap vs content-filter the opposite ways.
- `cancelled` (v1.5 `responses.cancel`) → **no `cancelled` status**; after cancelling the run, a **dialog asks
  the user to DELETE the job or MOVE it to `closed`** (keep the partial drafts as history when that makes
  sense), routing to `deleteJob` or the close path accordingly.

Note the **two distinct truncations**, kept as separate notices: the **input** parse-window cut (source > 50k
chars, §9 — full source saved) and the **output** token-cap cut (the run hit `max_output_tokens` — later source
never parsed). Different data-loss, different copy.

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
then disabled). `sourceText` stays the per-job working copy. **Gate-first:** `POST /ai/brain-dump` checks
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
| **Select source from my files** | **v1** | `GET /ai/brain-dump/sources` picker (text `file` items; paste notes via tag/re-parse) |
| **Discard a pending/in-progress job** | **v1** | `DELETE …/[jobId]`; deletes drafts + `sourceText`, **keeps the source item**; cancels the run if processing; confirm + tooltip |
| **Tolerant + tooltipped workflow** | **v1** | tooltips on every non-obvious affordance; confirm on discard; soft-delete-with-restore; no silent failures; Base UI `Tooltip` (+ the touch `Popover` pattern from `ai-usage-widget.tsx`) |
| **Re-parse any job** | **v1.5** | `POST …/re-parse` re-reads `sourceItemId` → new job; **consumes a fresh token** |
| **Cancel a running job** | **v1.5** | `client.responses.cancel(openaiResponseId)` (idempotent, background-only) then discard |
| **Job label** | **v1.5** | `sourceName` in `/parse` index, badge tooltip, review header (distinguishes concurrent jobs) |
| **Parse from the stash** | **v2** | "Parse with Brain Dump" action on a text `file`/`note` item (find prior sources by the `brain-dump` tag) |
| **Merge / aggregate review across jobs** | **v2** | one board over several jobs; multi-job commit (cross-job DnD — heavy) |
| **De-dup vs the existing stash** | **v2** | flag drafts that duplicate saved items |
| **Bulk board actions** | **v2** | per-bucket "Save all in this bucket" + Trash bulk (restore all / delete all) |
| **Abandoned-job TTL cleanup (24 h)** | **v2** | TTL/cron; manual Discard reduces urgency |
| **Source provenance** | **v2** | line-numbered input → per-item `sourceLines`/`sourceQuote`; client highlights deterministically; "Source" peek in the drawer |
| **Job lifecycle: `closed` history + rich `failed` + terminal mapping** | **v2.5** | §11.5 — commit demotes job to `closed` stub (keeps committable Trash); `failed` gains required rich detail; OpenAI `incomplete`/`content_filter` mapping; list-view delete; per-item collection-confirm dialog; `max_output_tokens`→16k |
| **Strict type/language boundaries** | **v3** | §11.4 — distinct command vs snippet language sets; picker filters by type; AI prompt + `parseBrainDumpLine` use the language set as a classification disambiguator |
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
- **AI classification tightening** (`BRAIN_DUMP_SYSTEM_PROMPT` + `parseBrainDumpLine` in `src/lib/ai/brain-dump.ts`;
  mirror in `ai-file-splitter-prompt.md`) — snippet `language` ∈ programming (never shell); command
  `language` ∈ shell/CLI only; tie-breaker *"runnable in a terminal → command; source you'd paste into a
  file → snippet."* `parseBrainDumpLine` uses the language set as a **disambiguator**: a `snippet` carrying a
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
  allow-list rejection of non-text targets (incl. `link`); `parseBrainDumpLine` language-disambiguation cases.
  (Undo/toast/Select are component-level → out of the server/util test scope, per §13.)

### 11.5 Job lifecycle: `closed` history, rich `failed`, terminal mapping, list delete — v2.5
Hardens the job lifecycle after the happy path: the **`closed`** history state (+ its board mode, self-heal,
stub stats), rich `failed` detail, list/History surfaces, atomic commit, and the concurrency guards. Status
semantics live in §10 (model + OpenAI mapping); the output budget in §12; verification in §14.

- **`closed` = post-commit history stub (kept, not deleted).** Today `commitJob` **deletes** the job on
  full success. v2.5 **demotes it to `closed`** instead: on "Save all" *and* on **auto-close after the last
  non-trashed draft is committed per-item**, the job clears `sourceText`, sets `status='closed'`, and stamps
  denormalized stats (`committedCount` + the `committedByType` per-type map). Committing a draft **deletes** it
  (per-draft create+delete is one atomic `$transaction`, §4), so by close time only **trashed** drafts
  remain — the close path keeps them, so a closed job still shows its Trash bucket. (A `closed` job thus
  never holds a committed draft: there is no draft-vs-its-own-live-copy duplicate — see de-dup below.)
- **Close self-heals (idempotent).** The close transition (set `closed` + clear `sourceText` + stamp stats)
  is a **separate write after** the per-draft commits land, so a crash/network failure *between* the last
  commit and the close-write would leave the job `completed` with **zero non-trashed drafts** — a stuck
  limbo. That exact shape (`completed` && no non-trashed items) is treated as an **implicit close-pending**
  state and **self-heals to `closed`** (stamps stats) the next time it's read. The reliable trigger is
  `getParseJobSnapshot` (the user opening the job via deep-link); note `listActiveParseJobs` already
  **excludes** a zero-non-trashed `completed` job (its filter is `completed && items.some(!trashed)`), so the
  limbo job never wrongly shows as "needs action" in the meantime — it simply heals into History on the next
  snapshot read (and the lazy job-list sweep can opportunistically heal stragglers). No drafts are lost, no
  job sticks half-closed. This also covers a "Save all" that committed every draft but failed before demoting.
- **Atomic per-draft commit.** Per §4: each draft's create-live-item + delete-draft is one
  `prisma.$transaction` (replaces the built two-write sequence + its accepted one-item-dup crash window).
  The enabling change is an **additive, non-breaking** tweak to shared `createItem` — an optional last param
  `tx?: Prisma.TransactionClient` (defaults to the module `prisma`, so **all existing callers are
  untouched**); only its *writes* run on `tx`. `commitDrafts` wraps `createItem(…, tx)` + the draft delete in
  one transaction; the batch still iterates drafts so a per-draft failure leaves the rest committable. Keep
  the shared-code blast radius minimal (§4 scope guard).
- **Closed-job Trash stays actionable (reuses the same board, in a `closed` mode).** Opening a `closed` job
  routes to the **same `/parse/[jobId]` board** — no dedicated history view — but the page **branches on
  `status==='closed'`**: it **suppresses** the progress header / "Resume parsing" / "Save all" chrome (a
  terminal job has nothing to stream or batch-commit), shows a **History banner + the stub stats**
  (`committedCount` + per-type), and renders **only the Trash bucket** — each trashed draft stays
  **editable (type/fields), restorable, and committable** per item (the only action a closed job supports).
  Adding this explicit `closed`-state rendering is the **main net-new UI surface** of v2.5. The stub holds
  **no references** to the items that already went live. Committing the **last** remaining trashed draft
  empties the job → a **dialog asks whether to fully delete the job** (don't auto-delete, don't silently
  keep). Each late commit **merges into the stub's stat map** (`committedCount` + `committedByType`) so the
  History stat stays accurate as leftovers trickle out (a small extra write; the `updatedAt` refresh is
  harmless because the TTL sweep excludes `closed` **by status**, not `updatedAt`).
- **List surfaces — active vs. history are separate queries.** `listActiveParseJobs` (today `processing` +
  `completed`-with-committable-drafts) **adds `failed`** to its `OR`, so a failed job is **reachable** in the
  `/parse` index — otherwise it's a dead end (the user must open it to read the remediation, commit partials,
  or delete it). `closed` jobs are **not** in the active list; a **new `listClosedParseJobs(userId)`**
  (paginated, newest-first, IDOR-scoped) feeds a distinct **"History"** section on `/parse` where the per-row
  list-view delete lives — keeping "needs action" (processing/completed/failed) cleanly apart from "archived"
  (`closed`).
- **`closed` is terminal — not resumable, not re-parsable.** To run the source again the user starts a fresh
  Brain Dump from the durable source item in the stash (the source survives commit, tagged `brain-dump`).
- **Auto-close guards.** Auto-close fires **only** from a non-`processing` job (a streaming job can't have
  "all drafts committed"), avoiding a race with the single-flight lock / a live resume. On auto-close the UI
  shows a **toast and redirects to the dashboard**.
- **`failed` rich detail (required) + remediation.** Whenever the route sets `failed` it writes a structured
  detail — **human-readable description first**, then everything collectable: reason category (model-error /
  timeout / invalid-output / `content_filter`, read from `response.error` / `incomplete_details.reason`),
  drafts persisted before failure, and the cursor — replacing the current generic strings. Because a `failed`
  run is a **technical fault a blind re-run would most likely reproduce**, the detail also surfaces
  **actionable remediation steps** ("what to fix before the next run" — e.g. trim the source, remove the
  content the filter flagged), so the user has a path forward rather than a dead end. A `failed` job's partial
  drafts **stay committable** (Save all / per-item) — `commitJob` only blocks `processing`; the user commits
  what arrived or **deletes** the job. There is **no re-parse button on a failed job** (see re-parse rule
  below); a genuine retry goes through **Parse from the stash** on the durable source item after addressing
  the remediation.
- **Re-parse is `completed`-only.** The per-job **Re-parse** button (v1.5, `…/re-parse`) is shown **only when
  the job is `completed`**, and the route **server-rejects** it for `processing` / `failed` / `closed`
  (`closed` is already terminal; `failed` would reproduce the fault; `processing` should resume, not
  re-parse). **Parse from the stash** (v2, acting on the source *item*) is **unaffected** — it works on any
  eligible `file`/`note` regardless of any job's state, since the source item outlives the job and is the
  sanctioned re-run entry point for failed/closed cases.
- **De-dup spans the committable states.** The advisory "possible duplicate" badge (computed once per snapshot
  in `getParseJobSnapshot`, currently gated to `status==='completed'`) extends to **`failed`** too — its
  partial drafts are now committable, so the duplicate warning is useful there. `processing` (hot stream path)
  and `closed`-job Trash (marginal leftovers) are skipped. Advisory only — never blocks commit.
  - **What "duplicate" compares (clarification).** De-dup matches a draft against the user's **other,
    pre-existing committed stash items** (title-match OR content-substring, via `findDuplicateMatches`) —
    *not* against the item the draft itself becomes. Because commit **deletes the draft and creates the live
    item atomically**, a draft never coexists with its own committed copy, so there is **no
    draft-vs-self duplicate** to suppress. The one sibling case — two near-copy drafts in the *same* job —
    is handled correctly with no special-casing: committing one makes it live, and the other's badge then
    *accurately* flags it (committing it would create a real second copy).
- **Bulk save-now coordinates with auto-close.** A v2 per-bucket "Save all" (bulk save-now) runs its whole
  fan-out (`Promise.allSettled` over the per-item commits) **first**, then evaluates auto-close **once** after
  all settle — never mid-batch — so the Nth commit can't close the job while earlier commits are still in flight.
- **Manual delete in any status (mostly built).** `DELETE /ai/brain-dump/{jobId}` → `deleteJob` already
  deletes a job in **any** status with a confirm dialog (on the review page) and keeps the source item.
  **Net-new:** a per-row **delete-with-confirm** on `/parse` — in the **History** section for `closed` jobs
  (which aren't opened as a board) and usable on `failed`/`completed` rows too — with **status-aware copy**:
  "discard drafts, source kept" for active/failed vs. "delete this history record — your committed items stay"
  for `closed`. Deleting a closed job cascades away its remaining trashed drafts. No new endpoint (reuses the
  existing DELETE); the History rows come from `listClosedParseJobs` (above).
- **Per-item collection-confirm dialog.** Full-job "Save all" **silently** auto-creates the target collection
  (current `resolveJobCollectionIds`, race-safe). For **per-item "Save now"** when the new-collection name
  isn't yet materialized, show a **confirm dialog** ("Create collection 'X' and add this item?") before
  creating — needs a create-confirmation flag threaded through the per-item commit path (`brainDump*` commit
  input + `commitDraftItem`/`resolveJobCollectionIds` honoring it → `paths.ts` + `openapi:gen`). Cancel commits
  the item **with no collection** (the user wants the item saved; they only declined the collection).
- **Concurrency & races (v2.5).** Three multi-actor races are closed without new locks:
  - **Double-commit** (two tabs "Save all" the same job): handled by the **delete-guards-create** ordering
    in the per-draft tx (§4) — the second actor's delete affects 0 rows → it skips, creating no duplicate.
  - **TTL sweep TOCTOU** (`sweepAbandonedParseJobs` does `findMany(stale ids)` then `deleteMany`): the
    `deleteMany` **re-asserts the predicate** (`updatedAt < cutoff AND status NOT IN ('closed')`) rather than
    keying on `id IN [...]` alone, so a job resumed / committed / closed in the select→delete window is
    skipped atomically — never deleting just-revived work. (This also folds in the `closed`-exclusion.)
  - **Collection-confirm** (sibling commit creates collection X between the client's existence-check and its
    create-confirmed commit): **no new race** — `resolveJobCollectionIds` already claim-and-creates X
    idempotently (guarded `updateMany` on `collectionName`), so at most one X is ever made regardless of the
    client's create flag or concurrent siblings. The confirm flag gates only the **prompt**, not creation safety.
- **Not added.** Auto-tagging committed items (they keep only **AI-inferred** tags; only the *source* item
  carries the `brain-dump` tag). A live "N of M remaining" during processing (the AI emits an unknown item
  count — only "N found so far" is truthful).

## 12. Non-functional requirements
**Access & quota** — Pro-only (route does its own `isPro` check → `403`); 1 Brain Dump/hr (`aiBrainDump`,
Upstash sliding window, keyed by `userId`); only `POST /ai/brain-dump` (+ planned re-parse) consumes;
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
limits (tags ≤ 5); `max_output_tokens: 16000` (raised from 8000 in v2.5) bounds cost/latency.

**Output budget vs. input window — independent, mismatched-scale budgets (Context7-verified).** The
**input** parse window (`SPLIT_FILE_MAX_INPUT_CHARS = 50_000` chars ≈ ~12.5k tokens at ~4 chars/token) and
the **output** budget (`max_output_tokens`, in tokens) sit on opposite ends of the pipeline and **do not
interfere** — but 50k input chars can yield more output than one run emits, so the *output* budget is the
real bottleneck. `max_output_tokens` bounds **visible *and* reasoning tokens** (Context7), so on the
reasoning model `gpt-5-mini` the 16k ceiling is *not* 16k tokens of items. Raising it 8k→16k fits more items
per run; a **soft prompt cap** ("keep items concise; aim for ≤ N") trims per-item waste. Truncation can't be
fully eliminated (a hard model ceiling remains), so the `incomplete`(`max_output_tokens`)→`completed`+notice
backstop stays. **Item cap + Bento board stay un-virtualized:** Context7 (TanStack Virtual) confirms
virtualization conflicts with this board's locked UX — its `measureElement` warns against animated size
changes, it requires a scroll container (vs. "all cards visible, no internal scroll"), and cross-list DnD into
virtualized buckets is unsupported. So the board keeps a hard item cap (raise modestly if needed) rather than
virtualizing — preserving the §4 masonry + pop-in animations.

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
token); the item cap keeps the board **un-virtualized** (a deliberate, Context7-backed choice — §12 — not
to be replaced by virtualization, which conflicts with the locked masonry/animated UX);
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

**Observability** — `logger.child({ tag: 'ai-brain-dump-stream' })` etc.; native Pino shape
(`log.info({ ids }, 'event')`, `Error` as `{ err }`); log job created, stream start/detach, completion
(count + duration), rate-limit hits, failures. No per-token noise. **(v2.5)** also log the new transitions
by extending the existing `finishJob`/commit/delete log lines: job→`closed` (with `committedCount`),
self-heal trigger, `failed`-with-reason (the structured detail), and sweep TOCTOU skips.

**Accessibility** — drag has a keyboard-accessible alternative (the drawer's type select); `@dnd-kit`
keyboard sensor + live-region announcements; type by **icon + label**, not color alone; all motion
`motion-safe:` (respects `prefers-reduced-motion`).

## 13. Tests (Vitest — server/util only; no component tests)
- `src/lib/ai/brain-dump.test.ts` — `parseBrainDumpLine` (valid/blank/incomplete/fenced; per-type
  normalization: link requires url, content dropped for file/link, tags lowercased/deduped/≤5);
  `consumeBrainDumpStream` flushes each draft batch with its boundary `sequence_number` cursor, holds the
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
- `src/lib/api/schemas/ai.test.ts` — **(v1)** `brainDumpInput` accepts exactly one of
  `{ text }`/`{ sourceItemId }`; `text` over `SPLIT_FILE_MAX_PASTE_BYTES` (~1 MB) invalid, while a long
  (but ≤ cap) paste is accepted **whole** (not 50k-clamped — the parse-window slice is server-side).
- **(v2.5)** `src/lib/ai/brain-dump.test.ts` — `consumeBrainDumpStream` branches `response.incomplete` by
  `incomplete_details.reason`: `max_output_tokens` → `incomplete` (route → completed+notice); `content_filter`
  → `filtered` (route → failed). `src/lib/db/ai-parse-jobs.test.ts` — `commitJob`/last-per-item-commit demote
  the job to **`closed`** (not delete) with `committedCount` stamped + `sourceText` cleared + **trashed drafts
  kept**; `sweepAbandonedParseJobs` **excludes `status='closed'`** (history never auto-purged); `listActiveParseJobs`
  excludes `closed`; `deleteJob` removes a `closed` job + its remaining trashed drafts; per-item commit honors the
  collection-create-confirmation flag (creates only when confirmed); `getParseJobSnapshot` computes de-dup for
  `completed` **and `failed`** (not `processing`/`closed`); **`commitDrafts` runs each draft's create+delete in one
  `$transaction`** — assert the draft is gone iff the item was created, and a mocked `createItem` failure leaves the
  draft intact (no partial state); **`listActiveParseJobs` now includes `failed`** (alongside processing/completed)
  and still **excludes `closed`**; **`listClosedParseJobs` returns only `closed`** (newest-first, paginated, IDOR);
  a **late trash-commit on a `closed` job merges into `committedCount` + `committedByType`** and leaves the job `closed`;
  a **`completed` job with zero non-trashed drafts self-heals to `closed`** (stats stamped) on the next snapshot/list read.
  **Concurrency:** `commitDrafts` **delete-guards-create** — a draft already deleted (0-row delete) is **skipped**, creating no
  duplicate item (simulate the second-actor race by pre-deleting the draft, assert `createItem` not called for it);
  `sweepAbandonedParseJobs`'s `deleteMany` **re-asserts `updatedAt < cutoff AND status != 'closed'`** in its WHERE (a job whose
  `updatedAt` is refreshed, or set `closed`, after selection is **not** deleted).
  `src/lib/db/items.test.ts` — `createItem` with the **optional `tx` param**:
  passing a tx client routes its writes through that client, and **omitting it is unchanged** (existing-caller
  regression guard — default `prisma` path still works). Route test — `failed` writes the rich detail (description + reason + remediation,
  not a generic string); the per-job **re-parse route rejects** `processing`/`failed`/`closed` (only `completed`
  allowed) and **consumes a token** on the `completed` path.
- `rate-limit.test.ts` — `aiBrainDump` = `{ attempts: 1, window: '1 h' }`; resume/list don't consume.
- Route test (mirrors `src/app/api/ai/ai.test.ts`) — `POST /ai/brain-dump` 401/403/429/201 (text **and**
  `sourceItemId`); over-cap paste → `422`; an unreadable/ineligible `sourceItemId` (not owned, binary, or
  S3 error) → `422` with **no token spent and no job created** (mock `getSourceText` to throw);
  **gate-first ordering**: a 403 (non-Pro) or 429 (2nd within the hour) creates **no** source item or job
  (assert `createItem`/`createParseJob` not called); re-parse consumes; resume/list/sources/snapshot/
  patch/delete/commit do **not** consume.

## 14. Verification
`npm run lint` + `npm run test:run`; `prisma migrate dev`/`status` on the **dev** branch;
`npm run openapi:gen` (no hand edits); `npm run build`.

**Playwright — core happy path:** upload → stream → **interrupt (close tab) → reopen → "Resume parsing"
continues from the cursor, no duplicate drafts** → drag → edit → delete → Save all → items exist; a 2nd
in-progress job is reachable from the entry badge / `/parse`; a 2nd *upload* within the hour → `429` while
resume of an existing job still works.

**Playwright — v2.5 lifecycle scenarios** (the finalization checklist for the new flows):
- **Commit → closed:** "Save all" → job becomes `closed`, **redirects to the dashboard** with a toast; the
  job leaves the active `/parse` list and appears in the **History** section.
- **Closed-board mode:** opening a `closed` job shows the History banner + stub stats and **only the Trash
  bucket** (no Resume / Save-all chrome); a trashed item can be edited + committed; committing the last one
  prompts the "delete the job?" dialog.
- **Failed job:** a `failed` job is reachable from the active list, shows the **rich detail + remediation**,
  lets the user commit its partial drafts, and offers **no Re-parse button**; Re-parse is present only on a
  `completed` job.
- **History delete:** per-row delete-with-confirm on a `closed` row (status-aware copy) removes it.
- **Collection-confirm:** per-item "Save now" with a not-yet-created target collection prompts the confirm
  dialog; Cancel commits the item with no collection; "Save all" creates it silently.

## 15. Out of scope (this feature)
Pro-tiered limits or changing the 1/hr cap (it gates *new* jobs only — resume, concurrency, and
re-parse-as-a-new-job are unrestricted); non-text formats (PDF/docx); auto-populating `file`/`image`
buckets from text; **automatic** (non-manual) resume; component unit tests. **Still carved out** (their own
spec/branch, `brain-dump-cross-job-and-provenance-spec.md`): **Merge / aggregate review across jobs** and
**Source provenance** — the two heaviest v2 items. A separate standalone dashboard card is rejected — the
Brain Dump card lives in the AI Usage widget. *(De-dup, bulk actions, parse-from-stash, TTL cleanup, live
type change, and strict type/language boundaries are **in scope** here — they are no longer out-of-scope as
the original v1-era text stated.)*

## 16. Reference
- Prompt artifact: `context/features/ai-file-splitter-prompt.md`
- Prototype: `prototypes/ai-file/index.html` (+ `screenshots/`)
