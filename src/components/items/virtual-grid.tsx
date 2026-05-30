'use client'

import { useEffect, type ReactNode } from 'react'
import { useVirtualizer } from '@tanstack/react-virtual'
import { useVirtualContainer } from '@/hooks/use-virtual-container'
import { useIntersectionObserver } from '@/hooks/use-intersection-observer'

export interface VirtualGridProps<T> {
  items: T[]
  hasMore: boolean
  loading: boolean
  onFetchMore: () => Promise<void>
  getColumns: (width: number) => number
  renderItem: (item: T, priority: boolean) => ReactNode
  gap?: number
  // Fixed height or a function that calculates height based on container width
  itemHeight: number | ((containerWidth: number) => number)
  overscan?: number
  sentinelRootMargin?: string
}

export function VirtualGrid<T>({
  items,
  hasMore,
  loading,
  onFetchMore,
  getColumns,
  renderItem,
  gap = 12,
  itemHeight,
  overscan = 2,
  sentinelRootMargin = '200px',
}: VirtualGridProps<T>) {
  const { containerRef, scrollMargin, cols, containerWidth, getScrollElement } = useVirtualContainer(getColumns)
  const { ref: sentinelRef, inView } = useIntersectionObserver({ rootMargin: sentinelRootMargin })

  const resolvedItemHeight = typeof itemHeight === 'function' ? itemHeight(containerWidth) : itemHeight

  const rowHeight = resolvedItemHeight + gap
  const rowCount = cols > 0 ? Math.ceil(items.length / cols) : 0

  const virtualizer = useVirtualizer({
    count: rowCount,
    getScrollElement,
    estimateSize: () => rowHeight,
    overscan,
    scrollMargin,
  })

  useEffect(() => {
    if (inView && hasMore && !loading) {
      onFetchMore()
    }
  }, [inView, hasMore, loading, onFetchMore])

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
                height: resolvedItemHeight,
                display: 'grid',
                gridTemplateColumns: `repeat(${cols}, 1fr)`,
                gap,
              }}
            >
              {rowItems.map((item, i) => renderItem(item, virtualRow.index === 0 && i < cols))}
            </div>
          )
        })}
      </div>
      {hasMore && <div ref={sentinelRef} className="h-4" />}
    </div>
  )
}
