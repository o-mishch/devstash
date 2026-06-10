import { useState, useEffect, useMemo } from 'react'
import debounce from 'lodash.debounce'
import { globalSearchAction, type SearchResult } from '@/actions/search'
import type { LightItem, SearchResultItem } from '@/types/item'
import type { SidebarCollection } from '@/types/collection'

export type DisplaySearchItem = LightItem | SearchResultItem

export function useGlobalSearch(
  query: string,
  localItemsData: LightItem[],
  localCollectionsData: SidebarCollection[]
) {
  const [loading, setLoading] = useState(false)
  const [remoteResults, setRemoteResults] = useState<SearchResult>({ items: [], collections: [] })

  const debouncedSearch = useMemo(
    () =>
      debounce(async (q: string) => {
        if (!q.trim()) {
          setRemoteResults({ items: [], collections: [] })
          setLoading(false)
          return
        }
        setLoading(true)
        try {
          const res = await globalSearchAction({ query: q })
          if (res.status === 'ok' && res.data) {
            setRemoteResults(res.data)
          } else {
            setRemoteResults({ items: [], collections: [] })
          }
        } finally {
          setLoading(false)
        }
      }, 300),
    []
  )

  useEffect(() => {
    debouncedSearch(query)
    return () => debouncedSearch.cancel()
  }, [query, debouncedSearch])

  const localItems = useMemo(() => {
    const q = query.toLowerCase()
    if (!q) return localItemsData.slice(0, 10)
    return localItemsData.filter(
      (item) =>
        item.title.toLowerCase().includes(q) ||
        item.descriptionPreview?.toLowerCase().includes(q) ||
        item.tags.some(t => t.toLowerCase().includes(q))
    )
  }, [localItemsData, query])

  const localCollections = useMemo(() => {
    const q = query.toLowerCase()
    if (!q) return localCollectionsData.slice(0, 10)
    return localCollectionsData.filter(
      (col) =>
        col.name.toLowerCase().includes(q) ||
        col.description?.toLowerCase().includes(q)
    )
  }, [localCollectionsData, query])

  const displayItems = useMemo(() => {
    const map = new Map<string, DisplaySearchItem>()
    localItems.forEach((i) => map.set(i.id, i))
    remoteResults.items.forEach((i) => {
      if (!map.has(i.id)) map.set(i.id, i)
    })
    return Array.from(map.values())
  }, [localItems, remoteResults.items])

  const displayCollections = useMemo(() => {
    const map = new Map<string, SidebarCollection>()
    localCollections.forEach((c) => map.set(c.id, c))
    remoteResults.collections.forEach((c) => map.set(c.id, c))
    return Array.from(map.values())
  }, [localCollections, remoteResults.collections])

  return {
    loading,
    displayItems,
    displayCollections
  }
}
