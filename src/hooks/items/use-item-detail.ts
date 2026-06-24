'use client'

import { useCallback, useState } from 'react'
import { useQueryClient, type QueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { $api } from '@/lib/api/client'
import { queryKeys } from '@/lib/api/query-keys'
import { useItemDrawerStore } from '@/stores/item-drawer-store'
import type { FullItem } from '@/types/item'

// The item drawer is fed by three GET caches: the single-shot /items/{id} (deep-link / preview / dup-badge
// opens, which need the whole item at once) and the progressive /items/{id}/details + /items/{id}/content
// (list opens, which start from a LightItem and lazy-load the rest). All three keys come from the central
// `queryKeys` registry so every reader and writer shares the exact same keys.

// Canonical key for the single-shot full item (GET /items/{id}). Re-exported from the registry for the
// existing call sites (use-infinite-items removeQueries, item-deep-link).
export const itemDetailQueryKey = queryKeys.items.detail

// Seeds all three caches from one full item. `FullItem` is `LightItem & ItemDetails & ItemContent`, so it
// carries every field the sub-caches hold. Writing all three keeps the deep-link and list-open paths
// consistent regardless of which warmed the cache first, and — written on save — keeps the drawer's
// /details + /content from serving a pre-edit copy under the 5-min staleTime.
function seedItemDetailCaches(queryClient: QueryClient, item: FullItem): void {
  queryClient.setQueryData(queryKeys.items.detail(item.id), item)
  queryClient.setQueryData(queryKeys.items.details(item.id), {
    description: item.description,
    updatedAt: item.updatedAt,
    collections: item.collections,
  })
  queryClient.setQueryData(queryKeys.items.content(item.id), { content: item.content, language: item.language })
}

// Returns a cached fetcher for the full item behind the drawer. `ensureQueryData` serves the cached copy
// without a network round-trip (and dedups concurrent calls by key), so re-previewing the same source or
// re-opening the same deep-link no longer re-requests the backend. Returns null on a 404/network error
// (the openapi queryFn re-throws on non-2xx) so callers can toast and skip opening, matching the prior
// `{ data }`-guarded behavior. The fetched item also seeds the /details + /content caches so a later
// list-open of the same item is served from cache too.
export function useFetchItemDetail() {
  const queryClient = useQueryClient()
  return useCallback(
    async (id: string): Promise<FullItem | null> => {
      try {
        const item = await queryClient.ensureQueryData(
          $api.queryOptions('get', '/items/{id}', { params: { path: { id } } }),
        )
        seedItemDetailCaches(queryClient, item)
        return item
      } catch {
        return null
      }
    },
    [queryClient],
  )
}

// Fetch-then-open-in-drawer, shared by the source banner and the source picker's preview. `openingId` is
// the id currently being fetched (null when idle) so a caller can spin / disable just that row. Toasts the
// caller-supplied message when the item is gone.
export function useOpenItemInDrawer(notFoundMessage = 'That item is no longer available.') {
  const fetchItemDetail = useFetchItemDetail()
  const openDrawer = useItemDrawerStore((state) => state.openDrawer)
  const [openingId, setOpeningId] = useState<string | null>(null)
  const open = useCallback(
    async (id: string): Promise<void> => {
      setOpeningId(id)
      const item = await fetchItemDetail(id)
      setOpeningId(null)
      if (item) openDrawer(item)
      else toast.error(notFoundMessage)
    },
    [fetchItemDetail, openDrawer, notFoundMessage],
  )
  return { open, openingId }
}

// Seeds the three item-detail caches from a fully-assembled item — used by the drawer once it has the full
// item (fetched progressively or just saved) so every other open path shares one consistent copy.
export function useCacheItemDetail() {
  const queryClient = useQueryClient()
  return useCallback((item: FullItem) => seedItemDetailCaches(queryClient, item), [queryClient])
}

interface ItemReadOptions {
  /** Defaults to true; gate the read on whether the drawer/banner actually needs this cache yet. */
  enabled?: boolean
}

// Live readers for the three GET caches, wrapping `$api.useQuery` so a component's read sits beside the
// writers above and shares the same registry keys — no raw `$api.useQuery` in components. Each gates itself
// on a non-null id, so callers pass the id straight through (no `id ?? ''` juggling at the call site).
export function useItemDetail(id: string | null, options?: ItemReadOptions) {
  return $api.useQuery(
    'get',
    '/items/{id}',
    { params: { path: { id: id ?? '' } } },
    // retry: false — the only live reader (the Brain Dump source banner) reads a denormalized id that may
    // point at a since-deleted item; a 404 should fall back to the stored name, not retry.
    { enabled: (options?.enabled ?? true) && id !== null, retry: false },
  )
}

export function useItemDetails(id: string | null, options?: ItemReadOptions) {
  return $api.useQuery(
    'get',
    '/items/{id}/details',
    { params: { path: { id: id ?? '' } } },
    { enabled: (options?.enabled ?? true) && id !== null },
  )
}

export function useItemContent(id: string | null, options?: ItemReadOptions) {
  return $api.useQuery(
    'get',
    '/items/{id}/content',
    { params: { path: { id: id ?? '' } } },
    { enabled: (options?.enabled ?? true) && id !== null },
  )
}
