'use client'

import { useState, useEffect, useMemo } from 'react'
import { useQuery, useQueryClient, type InfiniteData, type QueryClient } from '@tanstack/react-query'
import { safe } from '@orpc/client'
import { orpcClient } from '@/lib/api/client'
import type { SearchResult } from '@/types/search'
import type { LightItem, SearchResultItem, ItemsPage } from '@/types/item'
import type { SidebarCollection } from '@/types/collection'

export type DisplaySearchItem = LightItem | SearchResultItem

const EMPTY_RESULT: SearchResult = { items: [], collections: [] }

function readItemsFromCache(queryClient: QueryClient): LightItem[] {
  const seen = new Set<string>()
  return queryClient
    .getQueriesData<InfiniteData<ItemsPage>>({ queryKey: ['items'] })
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
  zustandItems: LightItem[],
  localCollectionsData: SidebarCollection[]
) {
  const queryClient = useQueryClient()

  // Part 1: local data — TanStack cache (all loaded pages) merged with Zustand
  // Zustand wins on conflict since it carries optimistic updates
  const [cachedItems, setCachedItems] = useState<LightItem[]>(() =>
    readItemsFromCache(queryClient)
  )

  useEffect(() => {
    const unsub = queryClient.getQueryCache().subscribe((event) => {
      if (event?.query.queryKey[0] === 'items') {
        // TanStack Query can fire cache events synchronously during another component's render
        // (e.g. when useInfiniteQuery receives initialData). Defer to avoid setState-in-render.
        queueMicrotask(() => setCachedItems(readItemsFromCache(queryClient)))
      }
    })
    return unsub
  }, [queryClient])

  const localItems = useMemo(() => {
    const map = new Map<string, LightItem>()
    cachedItems.forEach((i) => map.set(i.id, i))
    zustandItems.forEach((i) => map.set(i.id, i))
    return Array.from(map.values())
  }, [cachedItems, zustandItems])

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

  const { data: remoteData, isFetching: remoteLoading } = useQuery({
    queryKey: ['search', debouncedQuery],
    queryFn: async () => {
      const { error, data } = await safe(orpcClient.search.search({ q: debouncedQuery }))
      return error ? EMPTY_RESULT : data
    },
    enabled: !!debouncedQuery.trim(),
    staleTime: 30_000,
  })

  const remoteResults = remoteData ?? EMPTY_RESULT

  const displayItems = useMemo(() => {
    const map = new Map<string, DisplaySearchItem>()
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
