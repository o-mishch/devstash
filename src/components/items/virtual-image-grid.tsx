'use client'

import { useItemsStore } from '@/context/items-store-context'
import { ImageCard } from './image-card'
import { VirtualGrid } from './virtual-grid'

const GAP = 16

const getColumns = (width: number) => (width < 640 ? 2 : 3)

interface VirtualImageGridProps {
  pageKey: string
  onFetchMore: () => Promise<void>
}

export function VirtualImageGrid({ pageKey, onFetchMore }: VirtualImageGridProps) {
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
      gap={GAP}
      itemHeight={(width) => Math.round(((width - GAP * (getColumns(width) - 1)) / getColumns(width)) * (9 / 16))}
      renderItem={(item, priority) => (
        <ImageCard key={item.id} item={item} priority={priority} />
      )}
    />
  )
}
