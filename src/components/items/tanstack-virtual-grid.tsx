'use client'
'use no memo'

import { useVirtualizer } from '@tanstack/react-virtual'
import { useMemo, type ReactNode } from 'react'
import { useVirtualContainer } from '@/hooks/use-virtual-container'

interface TanStackVirtualGridProps<T> {
  items: T[]
  hasMore: boolean
  isLoading: boolean
  onLoadMore: () => void
  renderItem: (item: T, index: number) => ReactNode
  // Responsive column count derived from the measured container width.
  getColumns: (width: number) => number
  gap?: number
  columnGap?: number
  rowGap?: number
  itemHeight?: number
  // Taller row height used when `touch:` upsizing is active, so the larger cards
  // (bigger text + padding) still fit their virtualized slot. Defaults to itemHeight.
  touchItemHeight?: number
}

// 'use no memo': useVirtualizer returns unstable refs that React Compiler must not memoize
export function TanStackVirtualGrid<T>({
  items,
  hasMore,
  isLoading,
  onLoadMore,
  renderItem,
  getColumns,
  gap = 12,
  columnGap = gap,
  rowGap = gap,
  itemHeight = 300,
  touchItemHeight,
}: TanStackVirtualGridProps<T>) {
  // Measures the scroll container width and resolves it to a responsive column
  // count (1 full-width row per item on mobile, more columns as width grows).
  const { containerRef, cols, isTouch } = useVirtualContainer(getColumns)

  // On touch/narrow screens the upsized cards are taller — keep the virtualizer's
  // row height in sync so rows don't overlap.
  const effectiveItemHeight = isTouch && touchItemHeight ? touchItemHeight : itemHeight

  // Group items into rows of `cols`
  const rows = useMemo(() => {
    const result: (T | 'load-more')[][] = Array.from(
      { length: Math.ceil(items.length / cols) },
      (_, row) => items.slice(row * cols, row * cols + cols),
    )
    if (hasMore) {
      result.push(['load-more'] as unknown as (T | 'load-more')[])
    }
    return result
  }, [items, cols, hasMore])

  // Virtualize rows, not individual items
  const rowHeight = effectiveItemHeight + rowGap
  // eslint-disable-next-line react-hooks/incompatible-library
  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => containerRef.current,
    estimateSize: () => rowHeight,
    overscan: 2,
  })

  const virtualRows = virtualizer.getVirtualItems()
  const totalSize = virtualizer.getTotalSize()

  return (
    <div ref={containerRef} className="h-full w-full overflow-y-auto overflow-x-hidden" style={{ paddingTop: '8px' }}>
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
                gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))`,
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
                const itemIndex = virtualRow.index * cols + colIndex
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
                  <div key={itemIndex} style={{ height: `${effectiveItemHeight}px` }}>
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
