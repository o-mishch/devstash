'use client'

import { forwardRef, type ReactNode, type CSSProperties, type HTMLAttributes } from 'react'
import { VirtuosoGrid } from 'react-virtuoso'
import { useVirtualContainer } from '@/hooks/use-virtual-container'

/** Matches `hover:-translate-y-1` — reserved as pt-1/pb-1 on each cell so lift + shadow aren't clipped */
const HOVER_LIFT_PX = 4
const HOVER_LIFT_CELL_PX = HOVER_LIFT_PX * 2

function addHoverLiftPadding(value: CSSProperties['paddingBottom']): string | number {
  if (typeof value === 'number') return value + HOVER_LIFT_PX
  if (typeof value === 'string') return `calc(${value} + ${HOVER_LIFT_PX}px)`
  return HOVER_LIFT_PX
}

export interface VirtualGridProps<T> {
  items: T[]
  hasMore: boolean
  loading: boolean
  onFetchMore: () => Promise<void>
  getColumns: (width: number) => number
  renderItem: (item: T, priority: boolean) => ReactNode
  gap?: number
  itemHeight: number | ((containerWidth: number) => number)
  overscan?: number
  priorityCount?: number
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
  overscan = 400,
  priorityCount = 4,
}: VirtualGridProps<T>) {
  const { containerRef, cols, containerWidth, getScrollElement } = useVirtualContainer(getColumns)

  const resolvedItemHeight = typeof itemHeight === 'function' ? itemHeight(containerWidth) : itemHeight
  const scrollElement = getScrollElement()

  // VirtuosoGrid needs to know its custom scroll parent to function properly.
  // Delay rendering until the container finishes its first measurement.
  if (!scrollElement || cols === 0) {
    return <div ref={containerRef} className="h-full min-h-[500px] w-full min-w-0" />
  }

  return (
    <div ref={containerRef} className="w-full min-w-0 overflow-x-hidden">
      <VirtuosoGrid
        data={items}
        customScrollParent={scrollElement}
        endReached={() => {
          if (hasMore && !loading) {
            onFetchMore()
          }
        }}
        overscan={overscan}
        components={{
          List: forwardRef<HTMLDivElement, HTMLAttributes<HTMLDivElement>>(function GridList({ style, children, ...props }, ref) {
            const { paddingTop, paddingBottom, ...restStyle } = (style || {}) as CSSProperties
            return (
              <div
                ref={ref}
                {...props}
                className="min-w-0"
                style={{
                  ...restStyle,
                  marginTop: paddingTop,
                  marginBottom: addHoverLiftPadding(paddingBottom),
                  display: 'grid',
                  gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))`,
                  gap,
                  width: '100%',
                }}
              >
                {children}
              </div>
            )
          }),
          Item: ({ children, style, ...props }) => (
            <div
              {...props}
              className="relative min-w-0 overflow-visible pt-1 pb-1"
              style={{ ...style, height: resolvedItemHeight + HOVER_LIFT_CELL_PX, overflow: 'visible' }}
            >
              {children}
            </div>
          )
        }}
        itemContent={(index, item) => renderItem(item, index < priorityCount)}
      />
    </div>
  )
}
