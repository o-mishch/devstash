import { $api } from '@/lib/api/client'
import type { DataTag, InfiniteData, QueryKey } from '@tanstack/react-query'
import type { FetchItemsQuery, ItemsPage } from '@/types/item'

// [C] CLIENT-ONLY. TanStack Query is a browser concern: this module builds client cache keys on top of the
// `$api` browser client and must never be imported by a server module (`src/lib/db|infra|auth|...`, RSC
// data fetchers). The server cache boundary is the separate `CacheTags` registry in `src/lib/infra/cache.ts`
// [S]. Keep the two apart — do not cross-import. No `'server-only'` guard (it holds no secrets/Node APIs),
// but it is logically front-end-exclusive.
//
// ── Centralized TanStack Query key registry ───────────────────────────────────────────────────────
// The single source of truth for every client cache key in the app. Readers (useQuery), writers
// (setQueryData), and invalidators all derive their keys from here, so a key never drifts between the
// place that fills a cache and the place that busts it.
//
// Two key families coexist and both are modeled here:
//  • openapi-react-query keys — `$api.queryOptions('get', path, init).queryKey` = `['get', path, init]`.
//    Derived through `$api` so a hand-written key can never fall out of sync with the generated client.
//  • hand-rolled list keys — the paginated `['items', …]` family and the `['search', q]` cache, which
//    are plain `useInfiniteQuery`/`useQuery` keys with no `$api` counterpart.
//
// `init` varies per call (pagination cursor, source tab, …), so exact-key invalidation can't reach every
// variant. For those, use the `*Matches` predicates below, which match by `[method, path]` prefix.

// Synthetic params for the search-results slot in the items namespace. Deliberately NOT a real
// FetchItemsQuery variant (there is no 'search' branch) — it only ever flows into JSON.stringify
// below to produce a stable, distinguishable cache-key string, so it doesn't need that type at all.
const SEARCH_SLOT_PARAMS = { type: 'search' } as const

export const queryKeys = {
  items: {
    /** Root key — matches EVERY items query (all list variants + detail/content sub-caches share the prefix). */
    root: ['items'] as const,
    /** One paginated list variant (recent / by-type / by-collection / favorites). */
    list: (params: FetchItemsQuery): QueryKey => ['items', JSON.stringify(params)],
    /** Dedicated slot holding global-search hits — read by local-first search, ignored by list views.
     * `DataTag`-branded so its single-key `setQueryData`/`getQueryData` infer `InfiniteData<ItemsPage>`
     * without a manual generic (v5 tagged keys). The plural `setQueriesData({ queryKey: root })` paths
     * can't infer from a tag and keep their explicit generic — that's a TanStack typing limitation, not ours. */
    searchSlot: ['items', JSON.stringify(SEARCH_SLOT_PARAMS)] as DataTag<['items', string], InfiniteData<ItemsPage>>,
    /** Single-shot full item behind the drawer (GET /items/{id}). */
    detail: (id: string): QueryKey => $api.queryOptions('get', '/items/{id}', { params: { path: { id } } }).queryKey,
    /** Progressive drawer sub-cache: description/updatedAt/collections (GET /items/{id}/details). */
    details: (id: string): QueryKey =>
      $api.queryOptions('get', '/items/{id}/details', { params: { path: { id } } }).queryKey,
    /** Progressive drawer sub-cache: content/language (GET /items/{id}/content). */
    content: (id: string): QueryKey =>
      $api.queryOptions('get', '/items/{id}/content', { params: { path: { id } } }).queryKey,
  },
  /** Remote global-search results, keyed by the debounced query string. */
  search: (query: string): QueryKey => ['search', query],
  aiUsage: (): QueryKey => $api.queryOptions('get', '/ai/usage').queryKey,
  billingContext: (): QueryKey => $api.queryOptions('get', '/billing/context').queryKey,
  /** Full profile read (account summary, avatar, stats) behind the profile page. */
  profile: (): QueryKey => $api.queryOptions('get', '/profile').queryKey,
  userProfile: (): QueryKey => $api.queryOptions('get', '/profile/me').queryKey,
  editorPreferences: (): QueryKey => $api.queryOptions('get', '/profile/editor-preferences').queryKey,
  collections: {
    /** Every GET /collections variant. */
    list: (): QueryKey => $api.queryOptions('get', '/collections').queryKey,
    /** Single-shot collection detail (GET /collections/{id}). */
    detail: (id: string): QueryKey =>
      $api.queryOptions('get', '/collections/{id}', { params: { path: { id } } }).queryKey,
  },
} as const

// ── Prefix matchers for keys whose `init` varies ──────────────────────────────────────────────────
// Each returns a predicate for `invalidateQueries({ predicate })` that matches every `init` variant of an
// openapi-react-query path.
export const queryKeyMatches = {
  /** Both Brain Dump job lists — active (`{}`) and History (`{ history: '1' }`). */
  brainDumpJobs: (key: QueryKey): boolean => key[0] === 'get' && key[1] === '/ai/brain-dump',
  /** Both source-picker tabs — `file` and `content`. */
  brainDumpSources: (key: QueryKey): boolean => key[0] === 'get' && key[1] === '/ai/brain-dump/sources',
  /** Every GET /collections variant — the list (`/collections`), detail (`/collections/{id}`), and any sub-path.
   * Precise so a sibling path like `/collections-export` can never false-positive on a prefix match. */
  collections: (key: QueryKey): boolean =>
    key[0] === 'get' &&
    typeof key[1] === 'string' &&
    (key[1] === '/collections' || key[1] === '/collections/{id}' || key[1].startsWith('/collections/{id}/')),
} as const
