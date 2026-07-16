---
trigger: glob
globs:
  - src/**/*.ts
  - src/**/*.tsx
paths:
  - "src/**/*.ts"
  - "src/**/*.tsx"
description: State, data fetching, and validation for the Next.js app (legacy, maintenance-only) — Zustand vs TanStack Query ownership, self-sufficient TanStack components over prop-drilling, virtualization, and where Zod validation runs. Loads for files under src/. Split out of legacy-nextjs-architecture.md to stay under Antigravity's 12k per-file cap.
---

# Next.js State, Data Fetching & Validation (legacy)

> `src/` is maintenance-only — see `boundary.md`. Routing, skeletons, and file organization live in `legacy-nextjs-architecture.md`; the server/client bundle boundary in `legacy-server-client-boundary.md`.

## State Management

The **`createContext` ban is stated once in `react.md`** and applies here in full. Its Next-specific corollary: there is no `src/context/` directory, and `src/providers/` holds **only** composition wrappers for third-party providers (`QueryClientProvider`, `next-themes`) and store-connected mount points (item drawer, upgrade prompt) — never an app-authored React Context.

| State type | Tool | Package |
|---|---|---|
| Pure UI state (modals, drawers, selections, non-server flags) | Zustand store in `src/stores/` | `zustand` |
| Server / async data (items, collections, user profile, editor prefs, pages) | `$api` hooks; or `useQuery` / `useInfiniteQuery` for non-API data | `@tanstack/react-query` |
| Long lists / grids | `TanStackVirtualGrid` (`src/components/items/tanstack-virtual-grid.tsx`) | `@tanstack/react-virtual` |

**Zustand is for pure UI state only** — it must never hold server-derived data (user profile fields, feature flags, editor preferences, billing state). Server-derived state belongs in TanStack Query, seeded from SSR via a hydrator hook that calls `setQueryData` in a `useLayoutEffect`. New Zustand stores must not replicate DB-persisted values.

```typescript
// ✅ correct
import { useItemStore } from '@/stores/item-store'
const { selectedId, setSelectedId } = useItemStore()
```

### Prefer self-sufficient TanStack components over prop-drilling server state

A reusable client component that needs shared, cacheable server state (collections, the user profile, item types — anything backed by a `$api` query) should **read it from its own TanStack hook**, not receive it through a prop drilled down from an ancestor. Reach for a prop only as an **override** for a curated subset or an SSR-seed.

**Why this is safe — and better:**
- **One request, not N.** TanStack dedupes by query key: every component calling the same hook shares one underlying `Query` and one in-flight fetch. Ten self-sourcing dropdowns cause one request, not ten.
- **No fetch on mount/open.** These caches are SSR-seeded app-wide (app chrome) with a long `staleTime`, so the component reads cache instantly. It only fetches if nothing seeded it — an acceptable lazy fallback.
- **Never stale.** It reflects create/rename/delete from anywhere, with no prop to thread or keep in sync.

**Reference — `CollectionSelector`** (`src/components/shared/collection-selector.tsx`): `collections` is an optional override; omit it and the component self-sources via `useCollections()`. It also owns its own create flow end-to-end (the create dialog + auto-select), so every call site is just `<CollectionSelector creatable selectedIds={…} onChange={…} />` — zero per-call wiring.

```tsx
// ✅ correct — self-sources from the shared, deduped, SSR-seeded cache
function CollectionSelector({ collections: override, selectedIds, onChange }: Props) {
  const self = useCollections({ enabled: override === undefined }) // disabled when an override is given
  const collections = override ?? self.collections
  // …
}

// ❌ wrong — every ancestor must fetch and drill the same list down
<CollectionSelector collections={collections} … />   // collections threaded through 3 layers
```

**Rules:**
- Self-source shared server state by default; expose an optional list prop only for curated/SSR-seed cases (disable the internal query with `enabled` when the override is present, so it never idles a fetch).
- **Do not gate the query on transient UI** (e.g. `enabled: open`) when the component renders cached data while "closed" — a multiselect shows its selected chips' names before it is ever opened, so it needs the data unconditionally. Lazy-on-open is fine only when nothing is shown until open.
- Cache **writes** still follow the updater rule in `legacy-coding-standards.md`: `setQueryData`/`invalidateQueries` live in the owning hook, never in the component.

### Virtualization (`@tanstack/react-virtual`)

Use the existing `TanStackVirtualGrid` for any long item list or grid — do not build a new virtualized component from scratch.

If a component must call `useVirtualizer` directly, it **must** add `'use no memo'` as the second directive (after `'use client'`). `useVirtualizer` returns unstable refs that the React Compiler must not memoize, and `// eslint-disable-next-line react-hooks/incompatible-library` is required on the call itself.

```typescript
'use client'
'use no memo'

import { useVirtualizer } from '@tanstack/react-virtual'

// eslint-disable-next-line react-hooks/incompatible-library
const virtualizer = useVirtualizer({ count, getScrollElement, estimateSize })
```

## Data Fetching

- Server components fetch via `src/lib/db/` helpers (not `prisma.*` inline)
- Client components fetch and mutate via the route-handler client (`api` / `$api` from `@/lib/api/client`) — not Server Actions (see [Where each mutation / fetch goes](#where-each-mutation--fetch-goes))
- Never use `fetch()` or `axios` directly for our API — call `api` / `$api`. (Direct-to-S3 uploads with progress are the one exception: `uploadToS3` in `src/lib/storage-client/s3-upload-client.ts`.)

## Validation

All external inputs (JSON bodies, query params, path params) must be validated with Zod before use.

**Route handlers** (the default): parse each source — body (`await request.json()`), query (`request.nextUrl.searchParams`), path params (`ctx.params`) — with `parseOr422(schema, value)` from `@/lib/api/http`, which returns `{ ok: false, res }` (a ready-made 422 `problem`) on failure. The schema lives in `src/lib/api/schemas/<domain>.ts` and is the same one `paths.ts` references. Reuse the client-safe validators in `src/lib/utils/validators.ts` where they fit.

```ts
// schemas/items.ts  [C]
export const createItemInput = z.object({ /* … */ })

// app/api/items/route.ts  [S] — parse, then userId from session (IDOR-safe)
export const POST = authedRoute({ rateLimit: 'itemMutation' }, async ({ userId, request }) => {
  const parsed = parseOr422(createItemInput, await request.json())
  if (!parsed.ok) return parsed.res
  return json(await createItem(userId, parsed.data), 201)
})
```

**Server Actions** use `parseOrFail` (from `@/lib/utils/validators`), which returns a failed `ActionState` on failure.
