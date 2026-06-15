import { useMemo } from 'react'
import { useInfiniteQuery, useQueryClient, type InfiniteData, type Query } from '@tanstack/react-query'
import { orpcClient } from '@/lib/api/client'
import type { FetchItemsQuery, ItemsPage, LightItem } from '@/types/item'

function itemsQueryKey(fetchParams: FetchItemsQuery) {
  return ['items', JSON.stringify(fetchParams)]
}

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

export function usePrependItem() {
  const queryClient = useQueryClient()
  return async (item: LightItem, collectionIds?: string[]) => {
    await queryClient.cancelQueries({ queryKey: ['items'] })
    queryClient.setQueriesData<InfiniteData<ItemsPage>>(
      {
        queryKey: ['items'],
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
  return (item: LightItem, next: boolean) => {
    queryClient.setQueriesData<InfiniteData<ItemsPage>>(
      { queryKey: ['items'] },
      (old) => mapItemInPages(old, item.id, { isFavorite: next })
    )
    queryClient.setQueriesData<InfiniteData<ItemsPage>>(
      {
        queryKey: ['items'],
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
    void queryClient.invalidateQueries({ queryKey: ['items'], refetchType: 'none' })
  }
}

export function usePatchItem() {
  const queryClient = useQueryClient()
  return (id: string, patch: Partial<LightItem>) => {
    queryClient.setQueriesData<InfiniteData<ItemsPage>>(
      { queryKey: ['items'] },
      (old) => mapItemInPages(old, id, patch)
    )
    // refetchType: 'none' avoids an immediate refetch that would race against the
    // server-side revalidateTag (which runs via after() — deferred post-response).
    // Data will be refetched on next navigation/focus when the cache is truly stale.
    void queryClient.invalidateQueries({ queryKey: ['items'], refetchType: 'none' })
  }
}

export function useRemoveItem() {
  const queryClient = useQueryClient()
  return (id: string) => {
    queryClient.setQueriesData<InfiniteData<ItemsPage>>(
      { queryKey: ['items'] },
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
    void queryClient.invalidateQueries({ queryKey: ['items'], refetchType: 'none' })
  }
}

export function useReplaceItem() {
  const queryClient = useQueryClient()
  return (tempId: string, realItem: LightItem) => {
    queryClient.setQueriesData<InfiniteData<ItemsPage>>(
      { queryKey: ['items'] },
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

export function useInvalidateItems() {
  const queryClient = useQueryClient()
  return () => void queryClient.invalidateQueries({ queryKey: ['items'] })
}

export function useInfiniteItems(
  fetchParams: FetchItemsQuery,
  initialData?: ItemsPage
) {
  const query = useInfiniteQuery({
    queryKey: itemsQueryKey(fetchParams),
    queryFn: async ({ pageParam }) =>
      orpcClient.items.list({ ...fetchParams, ...(pageParam ? { cursor: pageParam } : {}) }),
    initialPageParam: null as string | null,
    getNextPageParam: (lastPage) => lastPage.nextCursor ?? null,
    ...(initialData && { initialData: { pages: [initialData], pageParams: [null] } }),
  })

  const items: LightItem[] = useMemo(() => {
    const flat = query.data?.pages.flatMap(page => page.items) ?? []
    return flat.slice().sort((a, b) => Number(b.isPinned) - Number(a.isPinned))
  }, [query.data?.pages])

  return { ...query, items }
}
