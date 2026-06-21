# File Text Preview (in-drawer, read-only)

## Summary

For `file` item type, add a **read-only in-drawer preview** of text-based files. When a stored file is
text (by extension), the file drawer shows a **preview button**; pressing it server-reads a bounded
window of the S3 object, caches the text client-side (immutable, persisted across refresh), and renders
it in the existing read-only viewers. No new viewer is built — `.md` reuses the markdown viewer, all
other text types reuse the read-only Monaco code editor.

## Status

Spec'd, not coded. Branch TBD (`feature/file-text-preview`).

## Decisions (settled)

- **Render mapping**: `.md` (eventually `.txt`) → **MarkdownViewer**; all other text types
  (`json`, `yaml`/`yml`, `xml`, `toml`, `ini`, `csv`, …) → **read-only Monaco `CodeEditor`** with
  syntax highlighting resolved from the file extension.
- **Preview window**: reuse `SPLIT_FILE_MAX_INPUT_CHARS` (**50,000 chars**); bigger files are
  boundary-bounded server-side and the preview discloses `truncated` (notice + download-full CTA).
- **Caching**: TanStack Query, `staleTime: 'static'`, `gcTime: Infinity` (content is immutable per item).
- **Refresh survival**: persist **only** the file-text queries to **IndexedDB** via `persistQueryClient`
  (`idb-keyval`), `maxAge` = TTL. **Not** localStorage.
- **Progress**: **indeterminate** animated indicator (no fake %), driven by `fetchStatus`.
- **Click-lock**: preview button disabled while `fetchStatus === 'fetching'`; Query dedupes by key.

## What already exists (reuse, do not rebuild)

| Piece | Location | Note |
|---|---|---|
| Bounded S3 range read | `getTextFromS3(key, maxChars)` — `src/lib/storage/s3.ts:70` | `Range: bytes=0-N`, decodes UTF-8 once, returns `{ text, truncated }` |
| Markdown viewer (read-only, fullscreen) | `MarkdownViewer` / `MarkdownContentView` — `src/components/ui/markdown-viewer.tsx`, `src/components/shared/item-content-view.tsx:187` | GFM, dark/light aware, fullscreen chrome |
| Read-only code viewer | `CodeEditor` — `src/components/ui/code-editor.tsx:28` | already takes `readOnly` + `language` + `fullscreenLabel` |
| Language-by-extension resolver | `useMonacoLanguage(ext)` — `src/hooks/use-monaco-language.ts:20` | matches Monaco langs by id/alias/**extension**; unknown → `plaintext` |
| Monaco warmup | `EditorPreloader` — `src/components/shared/dynamic-editors.tsx:74` | worker pre-warmed at idle; preview opens warm |
| File drawer render point | `FileSectionContent()` — `src/components/items/drawer/item-drawer-view-content.tsx:33` | today: download chip only — preview section lands here |
| Signed-URL client cache (pattern reference) | `src/lib/api/signed-download-cache.ts` | precedent for client-side caching of file-derived data |
| Item model fields | `prisma/schema.prisma` — `fileUrl` (S3 key), `fileName`, `fileSize` | **no mime field**; text-eligibility comes from the `fileName` extension |

## Architecture / decisions rationale

### Decide previewability from the extension, server + client — no probe
The server already knows the extension from `fileName`. Text-eligibility is an extension check
(`md`, `txt`, `json`, `yaml`, `yml`, `xml`, `toml`, `ini`, `csv`) — the preview button renders the
moment the drawer opens, with **zero download**. (Reuse / align with `ALLOWED_FILE_EXTS`,
`FILE_ICON_TEXT_EXTS`.)

### Read on the server, never browser→S3
Browser-side `fetch()` of the signed S3 URL would require **S3 bucket CORS**, which this repo
deliberately does not have (every existing S3 read is server-side or an `<img>`/`<a download>` — none
need CORS). It would also pull the whole object (≤10 MB) just to preview. Instead, a small server route
calls the existing `getTextFromS3` helper and returns the bounded text — no CORS, no secret exposure,
small payload.

**New route**: `GET /api/items/{id}/file-text` → `{ text, truncated }`
- Auth + ownership + Pro check (mirror `src/app/api/download/[id]/url/route.ts`).
- Re-validate the extension is text-eligible server-side.
- `getTextFromS3(item.fileUrl, SPLIT_FILE_MAX_INPUT_CHARS)`.
- Standard endpoint shape: `route.ts` + `paths.ts` declaration + Zod schema in `schemas/`, then
  `npm run openapi:gen` (no hand edits to `openapi.json` / `src/types/openapi.ts`).

### Cache: TanStack Query, immutable, lazy
Content is immutable per item → Context7's `staleTime: 'static'` (blocks refetch-on-mount/focus/reconnect
and manual invalidation). Fetch is **lazy** via `enabled` (flips true on preview click). Reopen the
drawer in-session → instant.

```ts
// src/hooks/use-file-text.ts
export function useFileText(itemId: string, enabled: boolean) {
  return $api.useQuery('get', '/items/{id}/file-text',
    { params: { path: { id: itemId } } },
    { enabled, staleTime: 'static', gcTime: Infinity },
  )
}
```

### Refresh survival = persist the result (IndexedDB), not the in-flight request
An in-flight fetch cannot survive a refresh (browser aborts it, JS state resets). The durable lock the
user wants is achieved by **persisting the downloaded text**, so after first download — including after a
refresh — the cache rehydrates and the preview opens instantly with **no second download**.

- `persistQueryClient` + an IndexedDB persister (`idb-keyval`, ~15 lines per Context7).
- **Not** localStorage: sync, ~5 MB origin cap, string-only — wrong tool for cached file text, and it
  collides with the project's no-localStorage rule. IndexedDB is async, large-capacity, native types.
  This persists an **immutable content cache**, not app/user state.
- Scope with `dehydrateOptions.shouldDehydrateQuery` to persist **only** the `file-text` queries;
  items/collections/etc. stay server-fresh.
- `maxAge` = TTL; `buster` = format kill-switch.
- Provider change: swap `QueryClientProvider` → `PersistQueryClientProvider` in
  `src/components/shared/root-provider-shell.tsx` (contained).

### Render
- `.md` (later `.txt`) → `MarkdownContentView` / `MarkdownViewer` (read-only + fullscreen).
- All other text → `CodeEditor` with `readOnly`, `language={useMonacoLanguage(ext).resolvedLang}`,
  `fullscreenLabel`. Per Context7 the idiomatic read-only `@monaco-editor/react` setup is
  `options={{ readOnly: true }}` + dynamic `language` + `automaticLayout: true` — all already set in
  `CodeEditor`.

### Progress + click-lock
- **Indeterminate** animation (shimmer/sweep or button spinner) bound to `fetchStatus === 'fetching'`.
  A true % bar would require streaming the response body (`ReadableStream` + `Content-Length`) — not
  worth it for a bounded ≤200 KB payload; avoid the fake percentage.
- Button `disabled` while fetching; Query dedupes by key so a double-click can't launch two reads.

```ts
// button: disabled={query.fetchStatus === 'fetching'}; show shimmer while fetching
```

### Truncation
Surface the `truncated` flag from `getTextFromS3` with a "preview truncated" notice + download-full CTA,
consistent with how Brain Dump discloses truncation.

### Pro gating
Mirror the existing download-route checks (`file`/`image` are Pro-only types).

## Recommended shape (summary table)

| Concern | Recommendation |
|---|---|
| Is it previewable? | Extension check on `fileName` (server + client), no download |
| Reading content | `GET /items/{id}/file-text` → `getTextFromS3(key, 50_000)` → `{ text, truncated }` |
| CORS | Avoided (server reads, never browser→S3) |
| Caching | TanStack Query, `staleTime: 'static'`, lazy via `enabled` |
| Cross-session persist | IndexedDB persister scoped to file-text queries; `maxAge` TTL — never localStorage |
| Rendering | `.md`→`MarkdownContentView`; else read-only `CodeEditor` + `useMonacoLanguage` |
| Progress | Indeterminate animation bound to `fetchStatus`; no fake % |
| Click-lock | `disabled` while fetching; Query dedupes |
| Truncation | Surface `truncated` notice + download-full CTA |
| Pro gating | Mirror existing download route checks |

## Open question to confirm before build

- **Immutable vs replaceable content.** Persistence assumes file content is immutable within an item
  (as the platform spec states). If a file item's content can be **replaced in place**, key the cache by
  `itemId + fileSize` (or `updatedAt`) so a swap busts the stale entry. Cheap insurance — include it.
- New dependency: `idb-keyval` (for the IndexedDB persister).

## Verification (planned)

- `npm run lint` + Vitest for the new route/helper (server-side text read, ext validation, Pro/IDOR).
- `npm run openapi:gen` (no hand edits).
- Playwright happy path: open a `.md` file → preview renders in markdown viewer; open a `.json` file →
  read-only Monaco with JSON highlighting; button locks + animates during fetch; reopen drawer = instant;
  **refresh → preview still instant, no re-download**; truncation notice on an oversized file.
- `npm run build` (provider change touches rendering/bundling).

## Reference

- Context7: TanStack Query `staleTime: 'static'`, `persistQueryClient`, IndexedDB persister,
  `dehydrateOptions.shouldDehydrateQuery`; `@monaco-editor/react` read-only viewer config.
