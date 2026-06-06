'use client'

import { useEffect } from 'react'
import { useInfiniteItemsFetch } from './use-infinite-items-fetch'
import { useIntersectionObserver } from './use-intersection-observer'
import type { ItemsPage } from '@/types/item'
import type { fetchMoreItemsAction } from '@/actions/items'

type FetchItemsParams = Parameters<typeof fetchMoreItemsAction>[0]

export function useInfiniteScrollFetch(pageKey: string, firstPage: ItemsPage, fetchParams: FetchItemsParams) {
  const fetchState = useInfiniteItemsFetch(pageKey, firstPage, fetchParams)
  const { ref, inView } = useIntersectionObserver({ rootMargin: '200px' })

  const { hasMore, loading, fetchMore } = fetchState

  useEffect(() => {
    if (inView && hasMore && !loading) {
      void fetchMore()
    }
  }, [inView, hasMore, loading, fetchMore])

  return { ...fetchState, sentinelRef: ref }
}
