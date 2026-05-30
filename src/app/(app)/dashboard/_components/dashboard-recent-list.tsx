'use client'

import { useCallback, useEffect } from 'react'
import { ItemRow } from '@/components/dashboard/item-row'
import { useInfiniteScrollSync } from '@/hooks/use-infinite-scroll-sync'
import { ItemsStoreActionType } from '@/context/items-store-context'
import { useIntersectionObserver } from '@/hooks/use-intersection-observer'
import { fetchMoreItemsAction } from '@/actions/items'
import type { ItemsPage } from '@/types/item'

const PAGE_KEY = 'recent'

interface DashboardRecentListProps {
  firstPage: ItemsPage
}

export function DashboardRecentList({ firstPage }: DashboardRecentListProps) {
  const { items, hasMore, loading, state, dispatch } = useInfiniteScrollSync(PAGE_KEY, firstPage)
  const { ref: sentinelRef, inView } = useIntersectionObserver({ rootMargin: '200px' })

  const fetchMore = useCallback(async () => {
    const cursor = state.pageKey === PAGE_KEY ? state.cursor : null
    if (!cursor) return

    dispatch({ type: ItemsStoreActionType.SetLoading, loading: true })
    const result = await fetchMoreItemsAction({ type: 'recent' }, cursor)

    if (result.status === 'ok' && result.data) {
      dispatch({
        type: ItemsStoreActionType.AppendPage,
        items: result.data.items,
        cursor: result.data.nextCursor,
        hasMore: result.data.hasMore,
      })
    } else {
      dispatch({ type: ItemsStoreActionType.SetLoading, loading: false })
    }
  }, [state.pageKey, state.cursor, dispatch])

  useEffect(() => {
    if (inView && hasMore && !loading) {
      fetchMore()
    }
  }, [inView, hasMore, loading, fetchMore])

  return (
    <div className="flex flex-col gap-3">
      {items.map((item) => <ItemRow key={item.id} item={item} />)}
      {hasMore && <div ref={sentinelRef} className="h-4" />}
    </div>
  )
}
