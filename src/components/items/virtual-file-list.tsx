'use client'

import { useVirtualGridState } from '@/context/items-store-context'
import { FileRow } from './file-row'
import { VirtualGrid } from './virtual-grid'

// FileRow is py-3 flex items-center — height is 24px padding + ~32px content
const CARD_HEIGHT = 56
const GAP = 8 // gap-2

interface VirtualFileListProps {
  pageKey: string
  onFetchMore: () => Promise<void>
}

export function VirtualFileList({ pageKey, onFetchMore }: VirtualFileListProps) {
  const { items, hasMore, loading } = useVirtualGridState(pageKey)

  return (
    <VirtualGrid
      items={items}
      hasMore={hasMore}
      loading={loading}
      onFetchMore={onFetchMore}
      getColumns={() => 1}
      itemHeight={CARD_HEIGHT}
      gap={GAP}
      overscan={5}
      renderItem={(item) => <FileRow key={item.id} item={item} />}
    />
  )
}
