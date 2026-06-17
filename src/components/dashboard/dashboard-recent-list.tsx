'use client'

import { ItemRow } from '@/components/dashboard/item-row'
import { TanStackVirtualGrid, singleColumn } from '@/components/items/tanstack-virtual-grid'
import { useInfiniteItems } from '@/hooks/use-infinite-items'
import type { ItemsPage, LightItem } from '@/types/item'

interface DashboardRecentListProps {
  firstPage: ItemsPage
}

export function DashboardRecentList({ firstPage }: DashboardRecentListProps) {
  const { items, hasNextPage, fetchNextPage, isFetchingNextPage } = useInfiniteItems({ type: 'recent' }, firstPage)

  return (
    <TanStackVirtualGrid<LightItem>
      items={items}
      hasMore={hasNextPage ?? false}
      isLoading={isFetchingNextPage}
      onLoadMore={() => void fetchNextPage()}
      getColumns={singleColumn}
      itemHeight={56}
      columnGap={0}
      rowGap={12}
      renderItem={(item) => <ItemRow item={item} />}
    />
  )
}
