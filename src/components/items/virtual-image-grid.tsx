'use client'

import { useVirtualGridState } from '@/context/items-store-context'
import { ImageCard } from './image-card'
import { VirtualGrid } from './virtual-grid'

const GAP = 16

const getColumns = (width: number) => (width < 640 ? 2 : 3)

interface VirtualImageGridProps {
  pageKey: string
  onFetchMore: () => Promise<void>
}

export function VirtualImageGrid({ pageKey, onFetchMore }: VirtualImageGridProps) {
  const { items, hasMore, loading } = useVirtualGridState(pageKey)

  return (
    <VirtualGrid
      items={items}
      hasMore={hasMore}
      loading={loading}
      onFetchMore={onFetchMore}
      getColumns={getColumns}
      gap={GAP}
      overscan={200}
      priorityCount={2}
      itemHeight={(width) => Math.round(((width - GAP * (getColumns(width) - 1)) / getColumns(width)) * (9 / 16))}
      renderItem={(item, priority) => (
        <ImageCard key={item.id} item={item} priority={priority} />
      )}
    />
  )
}
