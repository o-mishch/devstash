# Feature Spec: Brain Dump — Cross-Job Review & Source Provenance

> Carved out of the Brain Dump v2 scope (`context/features/ai-file-splitter-spec.md` §11.3, both
> originally tagged **v2**). These are the **two heaviest** v2 capabilities — they were pulled out of the
> active v2 feature (`context/current-feature.md`) so v2 can ship the lighter four (parse-from-stash,
> de-dup, bulk actions, TTL cleanup) without blocking on board/commit and prompt/schema rework.
> Treat each as **its own feature/branch**, landing after v2.

## 1. Summary
Two independent follow-ups to the shipped Brain Dump (AI file-to-items splitter):
1. **Merge / aggregate review across jobs** — review and commit the drafts of several parse jobs on **one
   board**, including dragging cards **across jobs** and a **multi-job commit**.
2. **Source provenance** — trace every draft back to the exact lines of its source text, so the user can
   verify *"where did this item come from?"* via a per-draft "Source" peek.

Both are additive to the existing pipeline; neither changes the core background-streaming/resume engine.

## 2. Source of truth & naming
Code is authoritative. The shipped feature lives under **`brain-dump`** naming (not the spec's
`split-file`):
- Routes: `src/app/api/ai/brain-dump/**`. Schemas: `brainDump*` in `src/lib/api/schemas/ai.ts`.
- Splitter: `src/lib/ai/brain-dump.ts` (`BRAIN_DUMP_SYSTEM_PROMPT`, `parseBrainDumpLine`,
  `consumeBrainDumpStream`, …). Hooks: `src/hooks/use-brain-dump.ts`. DB helpers:
  `src/lib/db/ai-parse-jobs.ts`. Components: `src/components/parse/**`. Pages: `src/app/(app)/parse/**`.
- Data model: `AiParseJob` / `AiParseJobItem` (see the main spec §6). `BRAIN_DUMP_SOURCE_TAG = 'brain-dump'`.

Parent spec: `context/features/ai-file-splitter-spec.md` (full architecture, locked decisions, conventions).

## 3. Status
Not Started — both deferred from active v2.

---

## 4. Merge / aggregate review across jobs

### Goal
One review board spanning **multiple parse jobs** the user selects, with **cross-job** drag-to-reclassify
and a single **multi-job commit** that realizes all non-trashed drafts (per the existing `commitJob`
mapping) and tidies up every contributing job.

### Why it's heavy
- The board (`parse-review-board.tsx`) and stream/snapshot layer are **single-job** today
  (`/parse/[jobId]`, `useBrainDumpStream(jobId)`, snapshot keyed by one `jobId`). Aggregation needs a
  **multi-job snapshot** and a board that holds drafts from several jobs at once.
- Cross-job DnD means a draft's `jobId` can **change** on drop — today `patchDraftItem` only mutates
  within a job. Moving a draft between jobs is a re-parent (new `jobId`, preserve `userId`/fields), or the
  aggregate board must treat the union as one virtual job.
- Commit must be **atomic across jobs** (all-or-partial semantics, idempotent), then delete each fully
  committed job — a generalization of `commitJob`.

### Sketch (decide details at `start`)
- **Entry** — a multi-select on the `/parse` index (`parse-job-list.tsx`) → "Review together" →
  `/parse/aggregate?jobs=a,b,c` (or a new route). All selected jobs must be the same user (IDOR-scoped).
- **Data** — a new aggregate snapshot helper in `src/lib/db/ai-parse-jobs.ts`
  (`getAggregateSnapshot(userId, jobIds[])`) unioning drafts with their `jobId` retained per card.
- **Board** — reuse Bento buckets, but cards carry a job badge; cross-job moves either re-parent the draft
  (`patchDraftItem` gains an optional `jobId` target, re-validated server-side) or operate on the virtual
  union. Optimistic update + revert, consistent with the current board.
- **Commit** — `commitJobs(userId, jobIds[])` (or `POST /ai/brain-dump/commit` with a body of job ids):
  map every non-trashed draft → `createItem`, apply each job's collection target (or a shared one chosen on
  the aggregate board), delete fully committed jobs. Spends **no** AI token (commit never does).
- **Constraints** — only the **new-job** create path consumes `aiBrainDump`; aggregation/commit are free.
  New endpoint = `route.ts` + `paths.ts` + Zod + `npm run openapi:gen`. `userId` from session.

### Tests (server/util)
- `getAggregateSnapshot` unions drafts across jobs, IDOR-scoped (no cross-user leak).
- cross-job re-parent via `patchDraftItem` (new `jobId` re-validated for ownership).
- `commitJobs` maps non-trashed drafts across jobs, excludes trashed, deletes fully committed jobs,
  idempotent on re-commit.

---

## 5. Source provenance

### Goal
Every draft records **where in the source it came from** so the review UI can show a **"Source" peek**
(the originating lines / quote) in the draft drawer, letting the user verify the AI's extraction.

### Why it's heavy
- Requires the model to emit provenance per item → **prompt change** (`BRAIN_DUMP_SYSTEM_PROMPT` +
  mirror in `ai-file-splitter-prompt.md`), a **schema change** (`brainDumpDraftItemSchema` +
  `AiParseJobItem` columns), and **parser changes** (`parseBrainDumpLine` to read/normalize the new
  fields). Touches the data model, the splitter, and the drawer.
- Provenance must survive truncation, resume, and the JSONL boundary flush without breaking the existing
  cursor/atomic-persist invariants.

### Sketch (decide details at `start`)
- **Input** — feed the model a **line-numbered** source window so it can cite line ranges deterministically.
- **Per-item fields** — add `sourceLines` (e.g. `[start, end]`) and/or `sourceQuote` (a short verbatim
  excerpt) to `AiParseJobItem` + `brainDumpDraftItemSchema`. Prefer storing **line ranges** (compact) and
  resolving the quote client-side from the persisted `sourceText` when possible; fall back to a stored
  `sourceQuote` if the source item is later deleted.
- **Prompt/parser** — extend the JSONL contract with the provenance fields; `parseBrainDumpLine`
  tolerantly parses + normalizes them (missing/invalid → omit, never fail the draft — same lose-nothing
  posture as today).
- **UI** — a **"Source" peek** in the draft `Sheet` drawer (`parse-draft-card.tsx` drawer): highlight the
  cited lines / show the quote; deterministic client-side highlight against `sourceText`.
- **Migration** — additive columns on `AiParseJobItem`, `prisma migrate dev` on the **dev** Neon branch
  only; `npm run openapi:gen` after the schema change.

### Tests (server/util)
- `parseBrainDumpLine` parses valid `sourceLines`/`sourceQuote`, omits malformed/missing without dropping
  the draft.
- line-number windowing helper (if added) maps model-cited ranges back to source offsets correctly,
  including across a truncated parse window.
- (Drawer highlight is component-level → out of the server/util test scope, per the project test policy.)

---

## 6. Conventions (inherited from the parent spec)
- Client reads/mutations via `$api`/`api` only — never `fetch`/Server Actions. New endpoint = `route.ts` +
  `paths.ts` + shared Zod schema + `npm run openapi:gen` (no hand-edited `openapi.json`/`src/types/openapi.ts`).
- `userId` always from session (IDOR-safe); re-validate any client-supplied id (incl. `jobId` lists)
  server-side. Pro-gating + `aiBrainDump` 1/hr apply only to **new-job creation** — neither feature here
  spends an AI token.
- Tests mandatory for new server actions/utils (no component tests). DB work on the Neon **dev** branch only.
- Tailwind v4 (CSS config), no `React.` namespace, named prop interfaces, Pino native-shape logging.

## 7. Out of scope
- The four shipping v2 items (parse-from-stash, de-dup, bulk actions, TTL cleanup) — see
  `context/current-feature.md` / parent spec §11.3.
- v3 (live item type change + strict type/language boundaries — parent spec §11.4).
