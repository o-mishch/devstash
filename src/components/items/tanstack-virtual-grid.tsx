'use client'
'use no memo'

import { useVirtualizer } from '@tanstack/react-virtual'
import { useRef, useMemo, type ReactNode } from 'react'

interface TanStackVirtualGridProps<T> {
  items: T[]
  hasMore: boolean
  isLoading: boolean
  onLoadMore: () => void
  renderItem: (item: T, index: number) => ReactNode
  columns?: number
  gap?: number
  columnGap?: number
  rowGap?: number
  itemHeight?: number
}

// 'use no memo': useVirtualizer returns unstable refs that React Compiler must not memoize
export function TanStackVirtualGrid<T>({
  items,
  hasMore,
  isLoading,
  onLoadMore,
  renderItem,
  columns = 4,
  gap = 12,
  columnGap = gap,
  rowGap = gap,
  itemHeight = 300,
}: TanStackVirtualGridProps<T>) {
  const parentRef = useRef<HTMLDivElement>(null)

  // Group items into rows
  const rows = useMemo(() => {
    const result: (T | 'load-more')[][] = []
    for (let i = 0; i < items.length; i += columns) {
      result.push(items.slice(i, i + columns))
    }
    if (hasMore) {
      result.push(['load-more'] as unknown as (T | 'load-more')[])
    }
    return result
  }, [items, columns, hasMore])

  // Virtualize rows, not individual items
  const rowHeight = itemHeight + rowGap
  // eslint-disable-next-line react-hooks/incompatible-library
  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => rowHeight,
    overscan: 2,
  })

  const virtualRows = virtualizer.getVirtualItems()
  const totalSize = virtualizer.getTotalSize()

  return (
    <div ref={parentRef} className="h-full w-full overflow-y-auto overflow-x-hidden" style={{ paddingTop: '8px' }}>
      <div
        style={{
          height: `${totalSize}px`,
          position: 'relative',
          overflow: 'visible',
        }}
      >
        {virtualRows.map((virtualRow) => {
          const row = rows[virtualRow.index]
          return (
            <div
              key={virtualRow.key}
              style={{
                display: 'grid',
                gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))`,
                columnGap: `${columnGap}px`,
                rowGap: `${rowGap}px`,
                position: 'absolute',
                top: 0,
                left: 0,
                width: '100%',
                transform: `translateY(${virtualRow.start}px)`,
                overflow: 'visible',
              }}
            >
              {row.map((item, colIndex) => {
                const itemIndex = virtualRow.index * columns + colIndex
                if (item === 'load-more') {
                  return (
                    <button
                      key="load-more"
                      onClick={onLoadMore}
                      disabled={isLoading}
                      className="w-full py-4 col-span-full"
                    >
                      {isLoading ? 'Loading...' : 'Load more'}
                    </button>
                  )
                }
                return (
                  <div key={itemIndex} style={{ height: `${itemHeight}px` }}>
                    {renderItem(item, itemIndex)}
                  </div>
                )
              })}
            </div>
          )
        })}
      </div>
    </div>
  )
}
