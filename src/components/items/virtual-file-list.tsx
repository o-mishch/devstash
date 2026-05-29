'use client'

import { useVirtualizer } from '@tanstack/react-virtual'
import { useVirtualContainer } from '@/hooks/use-virtual-container'
import { FileRow } from './file-row'
import type { Item } from '@/types/item'

// FileRow is py-3 flex items-center — height is 24px padding + ~32px content
const ROW_HEIGHT = 56
const GAP = 8 // gap-2

interface VirtualFileListProps {
  items: Item[]
}

export function VirtualFileList({ items }: VirtualFileListProps) {
  const { containerRef, scrollMargin, getScrollElement } = useVirtualContainer()

  const virtualizer = useVirtualizer({
    count: items.length,
    getScrollElement,
    estimateSize: () => ROW_HEIGHT + GAP,
    overscan: 5,
    scrollMargin,
  })

  return (
    <div ref={containerRef} className="w-full">
      <div style={{ height: virtualizer.getTotalSize(), position: 'relative' }}>
        {virtualizer.getVirtualItems().map((virtualRow) => (
          <div
            key={virtualRow.index}
            style={{
              position: 'absolute',
              top: virtualRow.start - scrollMargin,
              left: 0,
              right: 0,
              paddingBottom: GAP,
            }}
          >
            <FileRow item={items[virtualRow.index]} />
          </div>
        ))}
      </div>
    </div>
  )
}
