import { useCallback, useMemo } from 'react'
import {
  infiniteQueryOptions,
  useInfiniteQuery,
  useQueryClient,
  type InfiniteData,
  type Query,
} from '@tanstack/react-query'
import { api } from '@/lib/api/client'
import { itemDetailQueryKey } from '@/hooks/use-item-detail'
import { useInvalidate } from '@/hooks/use-cache-invalidation'
import { queryKeys } from '@/lib/api/query-keys'
import type { FetchItemsQuery, ItemsPage, LightItem } from '@/types/item'

const itemsQueryKey = queryKeys.items.list

/** Merges `patch` into the item matching `id` across every page, leaving the rest untouched. */
export function mapItemInPages(
  old: InfiniteData<ItemsPage> | undefined,
  id: string,
  patch: Partial<LightItem>,
): InfiniteData<ItemsPage> | undefined {
  if (!old) return old
  return {
    ...old,
    pages: old.pages.map((page) => ({
      ...page,
      items: page.items.map((i) => (i.id === id ? { ...i, ...patch } : i)),
    })),
  }
}

function prependToPage(old: InfiniteData<ItemsPage> | undefined, item: LightItem): InfiniteData<ItemsPage> | undefined {
  if (!old?.pages.length) return old
  return {
    ...old,
    pages: [
      { ...old.pages[0], items: [item, ...old.pages[0].items] },
      ...old.pages.slice(1),
    ],
  }
}

// Items discovered via global search live in `queryKeys.items.searchSlot` — a dedicated slot in the
// ['items'] namespace that no component subscribes to (useInfiniteItems only requests genuine
// FetchItemsQuery variants), so it never renders in a list or affects pagination. readItemsFromCache (which
// scans every ['items'] entry) picks it up, so a search-fetched item joins the local-first search corpus
// and stays consistent with the broad ['items'] updaters below (patch / favorite / remove all match
// queryKeys.items.root). See the registry for why its {type:'search'} params are safe for the predicates.
const SEARCH_RESULTS_CAP = 50

/** Persists remote global-search hits into the items cache so they're reused by local-first search. */
export function useSeedSearchResultsCache() {
  const queryClient = useQueryClient()
  return useCallback(
    (items: LightItem[]) => {
      if (items.length === 0) return
      // No generic needed — queryKeys.items.searchSlot is DataTag-branded, so `old` infers as
      // InfiniteData<ItemsPage> | undefined (v5 tagged keys).
      queryClient.setQueryData(queryKeys.items.searchSlot, (old) => {
        const byId = new Map((old?.pages[0]?.items ?? []).map((i) => [i.id, i]))
        // Delete-before-set so a re-seen item moves to the tail; otherwise Map keeps its original
        // position and slice(-CAP) could evict a freshly-relevant hit before older ones.
        items.forEach((i) => {
          byId.delete(i.id)
          byId.set(i.id, i)
        })
        const merged = Array.from(byId.values()).slice(-SEARCH_RESULTS_CAP)
        return { pages: [{ items: merged, nextCursor: null, hasMore: false }], pageParams: [null] }
      })
    },
    [queryClient],
  )
}

export function usePrependItem() {
  const queryClient = useQueryClient()
  return async (item: LightItem, collectionIds?: string[]) => {
    await queryClient.cancelQueries({ queryKey: queryKeys.items.root })
    queryClient.setQueriesData<InfiniteData<ItemsPage>>(
      {
        queryKey: queryKeys.items.root,
        predicate: (query: Query) => {
          const raw = query.queryKey[1]
          if (typeof raw !== 'string') return false
          const params = JSON.parse(raw) as FetchItemsQuery
          if (params.type === 'recent') return true
          if (params.type === 'type') return params.typeName === item.itemType.name
          if (params.type === 'favorites') return item.isFavorite
          if (params.type === 'collection') return (collectionIds ?? []).includes(params.collectionId)
          return false
        },
      },
      (old) => prependToPage(old, item)
    )
  }
}

/**
 * Toggles an item's favorite state across every cached items query. Patches the
 * `isFavorite` flag everywhere (so the star is consistent in all lists) AND adds/
 * removes the item from the favorites list query — a plain patch can't, since the
 * newly favorited item isn't yet a member of that list (and an un-favorited one
 * must leave it).
 */
export function useToggleFavoriteInCache() {
  const queryClient = useQueryClient()
  const invalidate = useInvalidate()
  return (item: LightItem, next: boolean) => {
    queryClient.setQueriesData<InfiniteData<ItemsPage>>(
      { queryKey: queryKeys.items.root },
      (old) => mapItemInPages(old, item.id, { isFavorite: next })
    )
    queryClient.setQueriesData<InfiniteData<ItemsPage>>(
      {
        queryKey: queryKeys.items.root,
        predicate: (query: Query) => {
          const raw = query.queryKey[1]
          if (typeof raw !== 'string') return false
          return (JSON.parse(raw) as FetchItemsQuery).type === 'favorites'
        },
      },
      (old) => {
        if (!old) return old
        if (next) {
          const exists = old.pages.some((page) => page.items.some((i) => i.id === item.id))
          return exists ? old : prependToPage(old, { ...item, isFavorite: true })
        }
        return {
          ...old,
          pages: old.pages.map((page) => ({
            ...page,
            items: page.items.filter((i) => i.id !== item.id),
          })),
        }
      }
    )
    invalidate('items', { refetchType: 'none' })
  }
}

export function usePatchItem() {
  const queryClient = useQueryClient()
  const invalidate = useInvalidate()
  return (id: string, patch: Partial<LightItem>) => {
    queryClient.setQueriesData<InfiniteData<ItemsPage>>(
      { queryKey: queryKeys.items.root },
      (old) => mapItemInPages(old, id, patch)
    )
    // refetchType: 'none' avoids an immediate refetch that would race against the
    // server-side revalidateTag (which runs via after() — deferred post-response).
    // Data will be refetched on next navigation/focus when the cache is truly stale.
    invalidate('items', { refetchType: 'none' })
  }
}

export function useRemoveItem() {
  const queryClient = useQueryClient()
  const invalidate = useInvalidate()
  return (id: string) => {
    queryClient.setQueriesData<InfiniteData<ItemsPage>>(
      { queryKey: queryKeys.items.root },
      (old) => {
        if (!old) return old
        return {
          ...old,
          pages: old.pages.map((page) => ({
            ...page,
            items: page.items.filter((i) => i.id !== id),
          })),
        }
      }
    )
    invalidate('items', { refetchType: 'none' })
    // Drop the cached full-item detail so a stale copy can't be re-opened in the drawer after deletion.
    queryClient.removeQueries({ queryKey: itemDetailQueryKey(id) })
  }
}

export function useReplaceItem() {
  const queryClient = useQueryClient()
  return (tempId: string, realItem: LightItem) => {
    queryClient.setQueriesData<InfiniteData<ItemsPage>>(
      { queryKey: queryKeys.items.root },
      (old) => {
        if (!old) return old
        return {
          ...old,
          pages: old.pages.map((page) => ({
            ...page,
            items: page.items.map((i) => (i.id === tempId ? realItem : i)),
          })),
        }
      }
    )
  }
}

// Invalidates every cached items query. Pass 'none' to mark stale WITHOUT an immediate refetch
// (avoids racing the server-side revalidateTag that runs via after() — same rationale as usePatchItem
// / useRemoveItem). Omit it for a normal invalidate-and-refetch. Thin alias over the central registry.
export function useInvalidateItems() {
  const invalidate = useInvalidate()
  return (refetchType?: 'none') => invalidate('items', refetchType ? { refetchType } : undefined)
}

/**
 * Syncs collection membership in the TanStack Query cache after an item's collections change.
 * Removes the item from queries for collections it left, and prepends it to queries for
 * collections it joined. Call this alongside patchItem whenever collectionIds may have changed.
 */
export function useSyncItemCollections() {
  const queryClient = useQueryClient()
  return (itemId: string, item: LightItem, removedCollectionIds: string[], addedCollectionIds: string[]) => {
    if (removedCollectionIds.length > 0) {
      queryClient.setQueriesData<InfiniteData<ItemsPage>>(
        {
          queryKey: queryKeys.items.root,
          predicate: (query: Query) => {
            const raw = query.queryKey[1]
            if (typeof raw !== 'string') return false
            const params = JSON.parse(raw) as FetchItemsQuery
            return params.type === 'collection' && removedCollectionIds.includes(params.collectionId)
          },
        },
        (old) => {
          if (!old) return old
          return {
            ...old,
            pages: old.pages.map((page) => ({
              ...page,
              items: page.items.filter((i) => i.id !== itemId),
            })),
          }
        }
      )
    }
    if (addedCollectionIds.length > 0) {
      queryClient.setQueriesData<InfiniteData<ItemsPage>>(
        {
          queryKey: queryKeys.items.root,
          predicate: (query: Query) => {
            const raw = query.queryKey[1]
            if (typeof raw !== 'string') return false
            const params = JSON.parse(raw) as FetchItemsQuery
            return params.type === 'collection' && addedCollectionIds.includes(params.collectionId)
          },
        },
        (old) => prependToPage(old, item)
      )
    }
  }
}

// Typed, reusable infinite-query options for an items list variant. Co-locates the key (from the central
// registry), the fetcher, and the pagination config in one `infiniteQueryOptions` object — so it's shared
// by `useInfiniteQuery` here and any future `prefetchQuery`/`ensureQueryData`, and the helper tags the key
// with `InfiniteData<ItemsPage>`. The custom `['items', …]` key shape is kept deliberately (it's the
// namespace every optimistic updater + readItemsFromCache + searchSlot match on) — not openapi's $api key.
export function itemsInfiniteOptions(fetchParams: FetchItemsQuery, initialData?: ItemsPage) {
  return infiniteQueryOptions({
    queryKey: itemsQueryKey(fetchParams),
    queryFn: async ({ pageParam }) => {
      const { data, error } = await api.GET('/items', {
        params: { query: { ...fetchParams, ...(pageParam ? { cursor: pageParam } : {}) } },
      })
      if (error) throw new Error(error.message)
      return data
    },
    initialPageParam: null as string | null,
    getNextPageParam: (lastPage) => lastPage.nextCursor ?? null,
    // Surface a hard list-load failure via the central QueryCache onError handler (opt-in per query).
    meta: { errorMessage: 'Failed to load items' },
    ...(initialData && { initialData: { pages: [initialData], pageParams: [null] } }),
  })
}

export function useInfiniteItems(
  fetchParams: FetchItemsQuery,
  initialData?: ItemsPage
) {
  const query = useInfiniteQuery(itemsInfiniteOptions(fetchParams, initialData))

  const items: LightItem[] = useMemo(() => {
    const flat = query.data?.pages.flatMap(page => page.items) ?? []
    return flat.slice().sort((a, b) => Number(b.isPinned) - Number(a.isPinned))
  }, [query.data?.pages])

  return { ...query, items }
}
