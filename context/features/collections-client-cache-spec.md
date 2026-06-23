# Collections Client-Cache (TanStack Query) — Spec

**Status:** Proposed (not started). Own branch `feature/collections-client-cache`, landing after Brain Dump v2/v3.

> **Foundation note (2026-06-23):** Pillars 1–2 below now exist — the central key registry ([query-keys.ts](../../src/lib/api/query-keys.ts)) and the `useInvalidate(entity)` switch ([use-cache-invalidation.ts](../../src/hooks/use-cache-invalidation.ts)) shipped on the Brain Dump branch, so the §"Plumbing diffs" 1–2 slot in as written. Also, the collection mutations (form-dialog create/edit, delete) are now **`useMutation`-backed**, not raw `api.*` as §"Plumbing" assumed — not a conflict, and it makes the "add optimistic `setQueryData` only if a flash is felt" step a simple `onMutate` later. Still gated on a *felt* latency problem; still its own branch. **No client `/collections` reader exists yet**, so the true first step is creating one (a feature), not wiring invalidation.

> **TanStack-replaceability audit (2026-06-23).** A full sweep of client code (`src/hooks`, `src/components`, `src/stores`, `src/providers`, `src/lib/api`) for hand-rolled logic that a TanStack Query/Virtual built-in already provides. Result: the codebase is disciplined — manual fetching, polling, retry, infinite-scroll bookkeeping, virtualization, mutation queuing, and cross-component pending state are all already on TanStack primitives. Two findings, of which **one is now migrated and two are deliberate keeps**:
> - **Signed-URL download cache — MIGRATED (this branch).** The hand-rolled module-level `Map` cache + in-flight-dedup + TTL (`signed-download-cache.ts`) is replaced by the query cache: [use-pro-download-src.ts](../../src/hooks/use-pro-download-src.ts) is now `useQuery`-backed (dedup + cache come free), with a **functional `staleTime`** computed from the per-response `expiresAt` ([signed-url-ttl.ts](../../src/lib/api/signed-url-ttl.ts), unit-tested) replacing the manual expiry check, and imperative ops (`refresh`/`ensure`/`seed`/`clear`) via `fetchQuery`/`ensureQueryData`/`setQueryData`/`removeQueries` in a `useDownloadSrcActions()` hook (no `useQueryClient()` in components). This is the **template** for the optimistic-`setQueryData` step §"Plumbing" 3 anticipates.
> - **Kept — `<img>`-failure ledger** ([preview-failure-tracker.ts](../../src/lib/api/preview-failure-tracker.ts)). Tracks previews whose *browser image load* 404'd (the signed-URL fetch succeeds; the S3 object is gone) — an `onError`, not an HTTP error, so Query never sees it. Stays a plain module store, split out from the migrated cache above.
> - **Kept — search debounce** ([use-global-search.ts](../../src/hooks/use-global-search.ts)). Debounces the *query key*, which has no TanStack equivalent (`staleTime`/`enabled` can't debounce key formation). Correct as-is.
>
> Takeaway for this spec: nothing else in the client reinvents a TanStack primitive, so the collections work remains purely about converting RSC surfaces to client readers (§"The crux") — not about replacing custom caching.

## One-line goal
Replace the 6 collection-mutation `router.refresh()` calls with centralized TanStack Query invalidation so collection create / rename / delete / favorite reflect across surfaces without a full RSC round-trip — modeled on the **brain-dump** domain (the newest, lightest in-repo pattern), not the heavyweight `items` domain.

## Motivation & scope boundary
- **Correctness is already fine.** Today every collection mutation calls `router.refresh()` ([collection-header-actions.tsx:35](../../src/components/collections/collection-header-actions.tsx#L35), [collection-card-actions.tsx:31](../../src/components/dashboard/collection-card-actions.tsx#L31), [collection-delete-dialog.tsx:50](../../src/components/dashboard/collection-delete-dialog.tsx#L50), [collection-form-dialog.tsx:102](../../src/components/dashboard/collection-form-dialog.tsx#L102), [item-create-dialog.tsx:178](../../src/components/items/item-create-dialog.tsx#L178)). This is architecturally correct for RSC-rendered data. **This feature buys snappiness, not correctness.**
- **Build only if collection-mutation latency is a felt UX problem.** Otherwise defer indefinitely.
- **Out of scope:** the profile/billing/settings `router.refresh()` calls (all correct, all pure RSC, no client cache worth adding) and the account-deletion `router.refresh()` ([delete-account-dialog.tsx:46](../../src/components/profile/delete-account-dialog.tsx#L46) — a deliberate Router-Cache bust after `signOut`, must stay).

## The centralized architecture this must conform to
Three client-only `[C]` pillars (mirror the server `CacheTags` boundary, never cross it):
1. **Key registry** — [src/lib/api/query-keys.ts](../../src/lib/api/query-keys.ts). Prefer the **openapi key family** (`$api.queryOptions('get', path, init).queryKey`) over hand-rolled keys. The `['items', …]` namespace is hand-rolled *only* because items needs predicate-matching across many interdependent lists — collections does not.
2. **Invalidation switch** — [src/hooks/use-cache-invalidation.ts](../../src/hooks/use-cache-invalidation.ts). `useInvalidate(entity, {refetchType})` is the single fan-out point; `CacheEntity` is a closed union extended one case at a time.
3. **Hooks own `queryClient`** — never `useQueryClient()` in a component (coding-standards rule).

Key conventions:
- **`refetchType: 'none'`** lets the server-side `revalidateTag` (run via `after()`) win the race — the documented fix for the stale-read the [collection-header-actions.tsx:23](../../src/components/collections/collection-header-actions.tsx#L23) comment currently fights.
- Global **`staleTime: 5min`** ([query-client-provider.tsx:27](../../src/providers/query-client-provider.tsx#L27)) → an unmounted list stays "fresh" on return; a cross-surface mutation must invalidate with the right `refetchType` (precedent: [use-brain-dump.ts:492](../../src/hooks/use-brain-dump.ts#L492)).
- Mutations stay **raw `api.*` in orchestrator hooks**; `useMutation`+`onMutate` only for true optimistic-create.

## The brain-dump template (what to copy)
`brain-dump` jobs/sources is the model: openapi keys + a `queryKeyMatches` prefix predicate + one `CacheEntity` case + **invalidate-first** (no hand-maintained cross-list `setQueryData`). Collections maps onto it almost exactly — `GET /collections` already exists ([src/app/api/collections/route.ts](../../src/app/api/collections/route.ts)), so no custom key namespace is needed.

## Plumbing diffs (small — this is the whole "central" cost)

### 1. `query-keys.ts` — add a `collections` family + prefix matcher
```ts
// inside queryKeys
collections: {
  /** Every GET /collections variant (list + favorites filter, whatever the query shape is). */
  list: (): QueryKey => $api.queryOptions('get', '/collections').queryKey,
},

// inside queryKeyMatches
/** Every GET /collections variant, matched by path prefix. */
collections: (key: QueryKey): boolean =>
  key[0] === 'get' && typeof key[1] === 'string' && key[1].startsWith('/collections'),
```
> **No single-collection GET endpoint exists.** `/collections/{id}` has only PATCH + DELETE; the detail page reads `getCollectionById` server-side. So there is **no `collections.detail(id)` openapi key today**. The collection-detail header is therefore NOT cacheable without first adding a `GET /collections/{id}` route handler (= `route.ts` + `paths.ts` + `openapi:gen`). See the conversion table — that surface either stays on `router.refresh()` or pays for a new endpoint.

### 2. `use-cache-invalidation.ts` — one new entity case
```ts
export type CacheEntity =
  'items' | 'brainDumpJobs' | 'brainDumpSources' | 'aiUsage' | 'collections'

// in the switch:
case 'collections':
  void queryClient.invalidateQueries({
    predicate: (query) => queryKeyMatches.collections(query.queryKey),
    ...refetch,
  })
  return
```

### 3. New `src/hooks/use-collections.ts`
```ts
'use client'
import { useCallback } from 'react'
import { $api } from '@/lib/api/client'
import { useInvalidate } from '@/hooks/use-cache-invalidation'
import type { CollectionsResponse } from '@/types/...' // openapi-derived

/** Reader seeded from the RSC fetch (instant first paint, hydrated cache). */
export function useCollections(initialData?: CollectionsResponse) {
  return $api.useQuery('get', '/collections', {}, { ...(initialData && { initialData }) })
}

/** Single delegation to the central switch — components call this, never useQueryClient(). */
export function useInvalidateCollections(): (refetchType?: 'none' | 'all') => void {
  const invalidate = useInvalidate()
  return useCallback(
    (refetchType) => invalidate('collections', refetchType ? { refetchType } : undefined),
    [invalidate],
  )
}
```
> Add optimistic `setQueryData` updaters here **only if a round-trip flash is observed** — start without them. The favorite star already flips instantly via `useOptimisticToggle`; keep it.

## Per-call-site migration (swap `router.refresh()` → invalidate)
Each site keeps its existing raw `api.*` mutation; only the refresh line changes:
- **Favorite toggles** ([collection-header-actions](../../src/components/collections/collection-header-actions.tsx), [collection-card-actions](../../src/components/dashboard/collection-card-actions.tsx)) — keep `useOptimisticToggle`; replace `router.refresh()` with `invalidateCollections('none')`. The `'none'` is what retires the stale-read workaround the header comment describes.
- **Create / delete** ([collection-form-dialog](../../src/components/dashboard/collection-form-dialog.tsx), [collection-delete-dialog](../../src/components/dashboard/collection-delete-dialog.tsx), [item-create-dialog](../../src/components/items/item-create-dialog.tsx)) — `invalidateCollections('all')` if the affected list may be unmounted at mutation time (e.g. dashboard while a dialog is open), else `'none'`.

## The crux: per-surface RSC→client conversion (the real cost/risk)
Centralization is cheap; **converting RSC surfaces to client readers is the actual work, and it's binary per surface:**
- A surface left **RSC** is unaffected by `invalidate('collections')` — it still needs `router.refresh()`.
- Only a surface converted to `useCollections(initialData)` benefits.

So **you cannot half-migrate a surface.** The 6 collection-rendering surfaces each need conversion to a client reader seeded from their existing server fetch:

| Surface | Current RSC helper | Convert to |
|---|---|---|
| Dashboard preview ([dashboard/page.tsx](../../src/app/(app)/dashboard/page.tsx)) | `getCollectionsPreview` | `useCollections(initial)` |
| Collections list ([collections/(list)/page.tsx](../../src/app/(app)/collections/(list)/page.tsx)) | `getAllCollections` | `useCollections(initial)` |
| Favorites collections ([favorites/collections/page.tsx](../../src/app/(app)/favorites/collections/page.tsx)) | `getFavoriteCollections` | `useCollections(initial)` (filter client-side) |
| Collection detail header ([collections/[id]/page.tsx](../../src/app/(app)/collections/[id]/page.tsx)) | `getCollectionById` | **No GET /collections/{id} endpoint** → either keep `router.refresh()` here, or add a new GET route handler first (`route.ts` + `paths.ts` + `openapi:gen`). Lowest-value conversion; recommend leaving on `router.refresh()`. |
| Sidebar ([favorites/layout.tsx](../../src/app/(app)/favorites/layout.tsx) + shell) | `getSidebarCollections` | client reader; seed must thread through the shell layout (hardest seam) |
| Parse target list ([parse/[jobId]/page.tsx](../../src/app/(app)/parse/[jobId]/page.tsx)) | collection target list | reuse `useCollections` |

**First adopter:** whatever already reads `/collections` client-side (the collection picker in the create/edit dialogs) — route it through `useCollections()` to retire the ad-hoc query, validate the pattern, then convert surfaces one at a time. A surface not yet converted simply keeps `router.refresh()` — the two models coexist during migration.

## Tests (mandatory per project rules — server/util only, no component tests)
- `queryKeyMatches.collections` predicate (matches `['get','/collections',…]`, rejects `['get','/items',…]`).
- Any pure cache-updater added later (mirror `mapItemInPages`-style unit tests) — none needed for the invalidate-first MVP.
- MVP (list/favorites/sidebar/parse surfaces) adds **no new endpoint** → no `openapi:gen`, no `paths.ts`. The detail-header surface is the *only* one that would need a new `GET /collections/{id}` endpoint, and it's explicitly recommended to skip.

## Verification
- `npm run lint` + the predicate unit test.
- Manual: favorite-toggle a collection on the dashboard, confirm the detail header + sidebar reflect it without a full reload; create/delete a collection, confirm the list updates. (Playwright only if a flash is suspected — minimize per project norms.)

## Recommendation
Build the plumbing the **brain-dump way** (3 small edits), migrate surfaces **incrementally, invalidate-first**, add optimistic `setQueryData` only where a flash is felt. Defer off the current Brain Dump branch.
