'use client'

import { useItemsStore } from '@/context/items-store-context'
import { ItemCard } from './item-card'
import { VirtualGrid } from './virtual-grid'

const CARD_HEIGHT = 80 // h-20

function getColumns(width: number): number {
  if (width < 768) return 1
  if (width < 1024) return 2
  return 3
}

interface VirtualItemGridProps {
  pageKey: string
  onFetchMore: () => Promise<void>
}

export function VirtualItemGrid({ pageKey, onFetchMore }: VirtualItemGridProps) {
  const { state } = useItemsStore()
  const items = state.pageKey === pageKey ? state.items : []
  const hasMore = state.pageKey === pageKey ? state.hasMore : false
  const loading = state.pageKey === pageKey ? state.loading : false

  return (
    <VirtualGrid
      items={items}
      hasMore={hasMore}
      loading={loading}
      onFetchMore={onFetchMore}
      getColumns={getColumns}
      itemHeight={CARD_HEIGHT}
      renderItem={(item) => <ItemCard key={item.id} item={item} />}
    />
  )
}
