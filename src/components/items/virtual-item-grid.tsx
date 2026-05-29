'use client'

import { useVirtualizer } from '@tanstack/react-virtual'
import { useVirtualContainer } from '@/hooks/use-virtual-container'
import { ItemCard } from './item-card'
import type { Item } from '@/types/item'

const CARD_HEIGHT = 80 // h-20
const GAP = 12 // gap-3

function getColumns(width: number): number {
  if (width < 768) return 1
  if (width < 1024) return 2
  return 3
}

interface VirtualItemGridProps {
  items: Item[]
}

export function VirtualItemGrid({ items }: VirtualItemGridProps) {
  const { containerRef, scrollMargin, cols, getScrollElement } = useVirtualContainer(getColumns)

  const rowHeight = CARD_HEIGHT + GAP
  const rowCount = Math.ceil(items.length / cols)

  const virtualizer = useVirtualizer({
    count: rowCount,
    getScrollElement,
    estimateSize: () => rowHeight,
    overscan: 3,
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
                height: CARD_HEIGHT,
                display: 'grid',
                gridTemplateColumns: `repeat(${cols}, 1fr)`,
                gap: GAP,
              }}
            >
              {rowItems.map((item) => (
                <ItemCard key={item.id} item={item} />
              ))}
            </div>
          )
        })}
      </div>
    </div>
  )
}
