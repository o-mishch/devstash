'use client'

import { ItemRow } from '@/components/dashboard/item-row'
import { useInfiniteScrollFetch } from '@/hooks/use-infinite-scroll-fetch'
import type { ItemsPage } from '@/types/item'

const PAGE_KEY = 'recent'

interface DashboardRecentListProps {
  firstPage: ItemsPage
}

export function DashboardRecentList({ firstPage }: DashboardRecentListProps) {
  const { items, hasMore, sentinelRef } = useInfiniteScrollFetch(PAGE_KEY, firstPage, { type: 'recent' })

  return (
    <div className="flex flex-col gap-3">
      {items.map((item) => <ItemRow key={item.id} item={item} />)}
      {hasMore && <div ref={sentinelRef} className="h-4" />}
    </div>
  )
}
