'use client'

import { useVirtualizer } from '@tanstack/react-virtual'
import { useVirtualContainer } from '@/hooks/use-virtual-container'
import { ImageCard } from './image-card'
import type { Item } from '@/types/item'

const GAP = 16

const getColumns = (width: number) => (width < 640 ? 2 : 3)

interface VirtualImageGridProps {
  items: Item[]
}

export function VirtualImageGrid({ items }: VirtualImageGridProps) {
  const { containerRef, scrollMargin, cols, containerWidth, getScrollElement } = useVirtualContainer(getColumns)

  const itemWidth = containerWidth ? (containerWidth - GAP * (cols - 1)) / cols : 0
  const itemHeight = Math.round(itemWidth * 9 / 16)
  const rowHeight = itemHeight + GAP
  const rowCount = containerWidth ? Math.ceil(items.length / cols) : 0

  const virtualizer = useVirtualizer({
    count: rowCount,
    getScrollElement,
    estimateSize: () => rowHeight,
    overscan: 2,
    scrollMargin,
  })

  return (
    <div ref={containerRef} className="w-full">
      <div style={{ height: virtualizer.getTotalSize(), position: 'relative' }}>
        {virtualizer.getVirtualItems().map((virtualRow) => {
          const startIdx = virtualRow.index * cols
          const rowItems = items.slice(startIdx, startIdx + cols)

          return (
            <div
              key={virtualRow.index}
              style={{
                position: 'absolute',
                top: virtualRow.start - scrollMargin,
                left: 0,
                right: 0,
                height: itemHeight,
                display: 'grid',
                gridTemplateColumns: `repeat(${cols}, 1fr)`,
                gap: GAP,
              }}
            >
              {rowItems.map((item, i) => (
                <ImageCard
                  key={item.id}
                  item={item}
                  priority={virtualRow.index === 0 && i < cols}
                />
              ))}
            </div>
          )
        })}
      </div>
    </div>
  )
}
