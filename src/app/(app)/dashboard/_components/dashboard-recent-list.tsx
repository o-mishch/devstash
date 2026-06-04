'use client'

import { useEffect } from 'react'
import { ItemRow } from '@/components/dashboard/item-row'
import { useIntersectionObserver } from '@/hooks/use-intersection-observer'
import { useInfiniteItemsFetch } from '@/hooks/use-infinite-items-fetch'
import type { ItemsPage } from '@/types/item'

const PAGE_KEY = 'recent'

interface DashboardRecentListProps {
  firstPage: ItemsPage
}

export function DashboardRecentList({ firstPage }: DashboardRecentListProps) {
  const { items, hasMore, loading, fetchMore } = useInfiniteItemsFetch(PAGE_KEY, firstPage, { type: 'recent' })
  const { ref: sentinelRef, inView } = useIntersectionObserver({ rootMargin: '200px' })

  useEffect(() => {
    if (inView && hasMore && !loading) {
      void fetchMore()
    }
  }, [inView, hasMore, loading, fetchMore])

  return (
    <div className="flex flex-col gap-3">
      {items.map((item) => <ItemRow key={item.id} item={item} />)}
      {hasMore && <div ref={sentinelRef} className="h-4" />}
    </div>
  )
}
