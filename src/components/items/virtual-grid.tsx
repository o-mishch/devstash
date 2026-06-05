'use client'

import { forwardRef, type ReactNode, type CSSProperties, type HTMLAttributes } from 'react'
import { VirtuosoGrid } from 'react-virtuoso'
import { useVirtualContainer } from '@/hooks/use-virtual-container'

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
}: VirtualGridProps<T>) {
  const { containerRef, cols, containerWidth, getScrollElement } = useVirtualContainer(getColumns)

  const resolvedItemHeight = typeof itemHeight === 'function' ? itemHeight(containerWidth) : itemHeight
  const scrollElement = getScrollElement()

  // VirtuosoGrid needs to know its custom scroll parent to function properly.
  // Delay rendering until the container finishes its first measurement.
  if (!scrollElement || cols === 0) {
    return <div ref={containerRef} className="w-full h-full min-h-[500px]" />
  }

  return (
    <div ref={containerRef} className="w-full">
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
                style={{
                  ...restStyle,
                  marginTop: paddingTop,
                  marginBottom: paddingBottom,
                  display: 'grid',
                  gridTemplateColumns: `repeat(${cols}, 1fr)`,
                  gap,
                }}
              >
                {children}
              </div>
            )
          }),
          Item: ({ children, style, ...props }) => (
            <div
              {...props}
              style={{ ...style, height: resolvedItemHeight }}
            >
              {children}
            </div>
          )
        }}
        itemContent={(index, item) => renderItem(item, index < 4)}
      />
    </div>
  )
}
