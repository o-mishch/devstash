'use client'

import { History } from 'lucide-react'
import { ItemRow } from '@/components/dashboard/item-row'
import { TanStackVirtualGrid, singleColumn } from '@/components/items/tanstack-virtual-grid'
import { useInfiniteItems } from '@/hooks/use-infinite-items'
import { DashboardCollapsibleCard } from '@/components/dashboard/dashboard-collapsible-card'
import type { ItemsPage, LightItem } from '@/types/item'

interface DashboardRecentListProps {
  firstPage: ItemsPage
  defaultOpen: boolean
}

export function DashboardRecentList({ firstPage, defaultOpen }: DashboardRecentListProps) {
  const { items, hasNextPage, fetchNextPage, isFetchingNextPage } = useInfiniteItems({ type: 'recent' }, firstPage)

  return (
    <DashboardCollapsibleCard icon={History} title="Recent Items" section="recent" defaultOpen={defaultOpen}>
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
    </DashboardCollapsibleCard>
  )
}
