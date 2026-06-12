'use client'

import { Skeleton } from '@/components/ui/skeleton'
import { ItemRow } from '@/components/dashboard/item-row'
import { useInfiniteItems } from '@/hooks/use-infinite-items'
import { useAutoFetchNextPage } from '@/hooks/use-auto-fetch-next-page'
import type { ItemsPage } from '@/types/item'

interface DashboardRecentListProps {
  firstPage: ItemsPage
}

export function DashboardRecentList({ firstPage }: DashboardRecentListProps) {
  const { items, hasNextPage, fetchNextPage, isFetchingNextPage } = useInfiniteItems({ type: 'recent' }, firstPage)
  const { sentinelRef } = useAutoFetchNextPage(hasNextPage, isFetchingNextPage, fetchNextPage)

  return (
    <div className="flex flex-col gap-3">
      {items.map((item) => <ItemRow key={item.id} item={item} />)}
      {isFetchingNextPage && (
        Array.from({ length: 3 }).map((_, i) => (
          <div key={`skeleton-${i}`} className="h-14 flex items-center gap-3 px-2 rounded-xl">
            <Skeleton className="size-7 shrink-0 rounded" />
            <div className="min-w-0 flex-1 space-y-1">
              <Skeleton className="h-4 w-3/4" />
              <Skeleton className="h-3 w-1/2" />
            </div>
            <Skeleton className="h-4 w-20 shrink-0" />
          </div>
        ))
      )}
      {hasNextPage && <div ref={sentinelRef} className="h-4" />}
    </div>
  )
}
