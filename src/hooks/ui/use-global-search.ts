'use client'

import { useState, useEffect, useMemo } from 'react'
import { queryOptions, skipToken, useQuery, useQueryClient, type InfiniteData, type QueryClient } from '@tanstack/react-query'
import { api } from '@/lib/api/client'
import { useSeedSearchResultsCache } from '@/hooks/items/use-infinite-items'
import { queryKeys } from '@/lib/api/query-keys'
import type { LightItem, ItemsPage } from '@/types/item'
import type { SidebarCollection } from '@/types/collection'

interface SearchResult {
  items: LightItem[]
  collections: SidebarCollection[]
}

const EMPTY_RESULT: SearchResult = { items: [], collections: [] }

// Typed options for the debounced remote search. `skipToken` disables the query for an empty term in a
// type-safe way (vs `enabled: false`) — TanStack knows the query is idle, and the `query` param is always
// defined wherever the fetcher actually runs. Keyed per debounced term via the central registry.
function searchOptions(query: string) {
  const term = query.trim()
  return queryOptions({
    queryKey: queryKeys.search(term),
    queryFn: term
      ? async (): Promise<SearchResult> => {
          const { data, error } = await api.GET('/search', { params: { query: { q: term } } })
          return error ? EMPTY_RESULT : data
        }
      : skipToken,
    staleTime: 30_000,
  })
}

function readItemsFromCache(queryClient: QueryClient): LightItem[] {
  const seen = new Set<string>()
  return queryClient
    .getQueriesData<InfiniteData<ItemsPage>>({ queryKey: queryKeys.items.root })
    .flatMap(([, data]) => data?.pages ?? [])
    .flatMap((page) => page.items)
    .filter((item) => {
      if (seen.has(item.id)) return false
      seen.add(item.id)
      return true
    })
}

export function useGlobalSearch(
  query: string,
  localCollectionsData: SidebarCollection[]
) {
  const queryClient = useQueryClient()

  // Part 1: local data — the TanStack `['items']` cache (every loaded page, deduped). It already carries
  // the optimistic updates every mutation writes (create/edit/favorite/pin/delete), so it is the single
  // source for instant local results; anything not yet loaded is covered by the remote search below.
  const [localItems, setLocalItems] = useState<LightItem[]>(() =>
    readItemsFromCache(queryClient)
  )

  useEffect(() => {
    const unsub = queryClient.getQueryCache().subscribe((event) => {
      const queryKey = event?.query.queryKey as readonly unknown[] | undefined
      if (queryKey?.[0] === 'items') {
        // TanStack Query can fire cache events synchronously during another component's render
        // (e.g. when useInfiniteQuery receives initialData). Defer to avoid setState-in-render.
        queueMicrotask(() => setLocalItems(readItemsFromCache(queryClient)))
      }
    })
    return unsub
  }, [queryClient])

  const filteredLocalItems = useMemo(() => {
    const q = query.toLowerCase()
    if (!q) return localItems.slice(0, 10)
    return localItems.filter(
      (item) =>
        item.title.toLowerCase().includes(q) ||
        item.descriptionPreview?.toLowerCase().includes(q) ||
        item.tags.some((t) => t.toLowerCase().includes(q))
    )
  }, [localItems, query])

  const filteredLocalCollections = useMemo(() => {
    const q = query.toLowerCase()
    if (!q) return localCollectionsData.slice(0, 10)
    return localCollectionsData.filter(
      (col) =>
        col.name.toLowerCase().includes(q) ||
        col.description?.toLowerCase().includes(q)
    )
  }, [localCollectionsData, query])

  // Part 2: debounced remote search via TanStack Query — caches results per query string
  const [debouncedQuery, setDebouncedQuery] = useState(query)
  useEffect(() => {
    const t = setTimeout(() => setDebouncedQuery(query), 300)
    return () => clearTimeout(t)
  }, [query])

  const { data: remoteData, isFetching: remoteLoading } = useQuery(searchOptions(debouncedQuery))

  const remoteResults = remoteData ?? EMPTY_RESULT

  // Persist remote search hits into the ['items'] cache so they feed local-first search next time and stay
  // in sync with the shared item mutation updaters. Items are now full LightItems, so nothing is lost.
  const seedSearchResults = useSeedSearchResultsCache()
  useEffect(() => {
    seedSearchResults(remoteResults.items)
  }, [remoteResults.items, seedSearchResults])

  const displayItems = useMemo(() => {
    const map = new Map<string, LightItem>()
    filteredLocalItems.forEach((i) => map.set(i.id, i))
    remoteResults.items.forEach((i) => {
      if (!map.has(i.id)) map.set(i.id, i)
    })
    return Array.from(map.values())
  }, [filteredLocalItems, remoteResults.items])

  const displayCollections = useMemo(() => {
    const map = new Map<string, SidebarCollection>()
    filteredLocalCollections.forEach((c) => map.set(c.id, c))
    remoteResults.collections.forEach((c) => map.set(c.id, c))
    return Array.from(map.values())
  }, [filteredLocalCollections, remoteResults.collections])

  return {
    loading: remoteLoading,
    displayItems,
    displayCollections,
  }
}
