'use client'
'use no memo'

import { useVirtualizer } from '@tanstack/react-virtual'
import { useEffect, useMemo, type ReactNode } from 'react'
import { useVirtualContainer } from '@/hooks/use-virtual-container'

// Stable reference for single-column list callers so the grid's ResizeObserver effect doesn't
// re-subscribe each render. Shared by the dashboard recent list and the file list.
export const singleColumn = () => 1

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
  // count, and the list's offset within the shared <main> scroller (scrollMargin).
  const { containerRef, cols, isTouch, scrollMargin, getScrollElement } = useVirtualContainer(getColumns)

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

  // Virtualize rows, not individual items. The scroll element is the page's single
  // <main>; scrollMargin tells the virtualizer how far this list sits below the top
  // of that shared scroller so its coordinates line up.
  const rowHeight = effectiveItemHeight + rowGap
  // eslint-disable-next-line react-hooks/incompatible-library
  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement,
    estimateSize: () => rowHeight,
    overscan: 2,
    scrollMargin,
  })

  const virtualRows = virtualizer.getVirtualItems()
  const totalSize = virtualizer.getTotalSize()

  // Infinite scroll: when the trailing `load-more` row is windowed into view, fetch the
  // next page. Guarded by isLoading so it fires once per page; the React Query fetch flips
  // isLoading true immediately, blocking re-entry until the new page lands.
  const lastRowIndex = virtualRows.length > 0 ? virtualRows[virtualRows.length - 1].index : -1
  useEffect(() => {
    if (hasMore && !isLoading && lastRowIndex >= rows.length - 1) {
      onLoadMore()
    }
  }, [hasMore, isLoading, lastRowIndex, rows.length, onLoadMore])

  return (
    <div ref={containerRef} className="relative w-full" style={{ height: `${totalSize}px` }}>
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
              transform: `translateY(${virtualRow.start - scrollMargin}px)`,
              overflow: 'visible',
            }}
          >
            {row.map((item, colIndex) => {
              const itemIndex = virtualRow.index * cols + colIndex
              if (item === 'load-more') {
                // Trailing sentinel row: its windowing into view drives the infinite-scroll effect
                // above. Non-interactive (just a loading hint) so it can't double-fire the fetch.
                return (
                  <div
                    key="load-more"
                    className="col-span-full flex justify-center py-4 text-sm text-muted-foreground"
                  >
                    {isLoading ? 'Loading...' : null}
                  </div>
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
  )
}
