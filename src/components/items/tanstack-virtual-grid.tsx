'use client'
'use no memo'

import { useVirtualizer, useWindowVirtualizer, type VirtualItem } from '@tanstack/react-virtual'
import { useCallback, useEffect, useMemo, useState, type ReactNode, type RefObject } from 'react'
import { useVirtualContainer } from '@/hooks/use-virtual-container'
import { useIsTouch } from '@/hooks/use-is-touch'
import { useItemDrawerStore } from '@/stores/item-drawer-store'

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

// Public entry point. The desktop shell scrolls <main>; the mobile shell lets the *document*
// scroll (so the browser URL bar collapses), which means the window is the real scroller. The
// virtualizer must bind to whichever it is, and the window- vs element-virtualizer are distinct
// hooks — so we pick the implementation up front by `isTouch`. isTouch is stable per device (only
// flips when crossing the lg breakpoint, i.e. devtools resize), so this never remounts in normal
// use; a real phone always renders the window grid, a desktop always the element grid.
export function TanStackVirtualGrid<T>(props: TanStackVirtualGridProps<T>) {
  const isTouch = useIsTouch()
  return isTouch ? <WindowVirtualGrid {...props} /> : <MainVirtualGrid {...props} />
}

// Group items into rows of `cols`, appending a trailing `load-more` sentinel row when more pages
// remain (its windowing into view drives the infinite-scroll fetch in VirtualGridBody).
function useRows<T>(items: T[], cols: number, hasMore: boolean): (T | 'load-more')[][] {
  return useMemo(() => {
    const result: (T | 'load-more')[][] = Array.from(
      { length: Math.ceil(items.length / cols) },
      (_, row) => items.slice(row * cols, row * cols + cols),
    )
    if (hasMore) {
      result.push(['load-more'] as unknown as (T | 'load-more')[])
    }
    return result
  }, [items, cols, hasMore])
}

interface GridRows<T> {
  rows: (T | 'load-more')[][]
  // Row height that matches the upsized `touch:` cards on mobile, the default cards on desktop.
  effectiveItemHeight: number
  rowHeight: number
}

// Shared row model for both grid variants: the row matrix + the per-row height the virtualizer
// estimates with. `isTouch` is fixed per variant (window grid = touch, element grid = desktop), so
// the caller passes it in rather than re-deriving it from a device check here.
function useGridRows<T>(props: TanStackVirtualGridProps<T>, cols: number, isTouch: boolean): GridRows<T> {
  const { items, hasMore, itemHeight = 300, touchItemHeight, gap = 12, rowGap = gap } = props
  const effectiveItemHeight = isTouch ? touchItemHeight ?? itemHeight : itemHeight
  const rows = useRows(items, cols, hasMore)
  return { rows, effectiveItemHeight, rowHeight: effectiveItemHeight + rowGap }
}

// Desktop: <main> is the scroll element. scrollMargin is the list's offset within that scroller.
function MainVirtualGrid<T>(props: TanStackVirtualGridProps<T>) {
  const { containerRef, cols, scrollMargin } = useVirtualContainer({ getColumns: props.getColumns, windowMode: false })
  // <main> is this list's scroller on desktop; the element virtualizer binds to it.
  const getScrollElement = useCallback(
    () => containerRef.current?.closest('main') as HTMLElement | null,
    [containerRef],
  )
  const { rows, effectiveItemHeight, rowHeight } = useGridRows(props, cols, false)
  // eslint-disable-next-line react-hooks/incompatible-library
  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement,
    estimateSize: () => rowHeight,
    overscan: 2,
    scrollMargin,
  })

  return (
    <VirtualGridBody
      {...props}
      containerRef={containerRef}
      cols={cols}
      effectiveItemHeight={effectiveItemHeight}
      scrollMargin={scrollMargin}
      rows={rows}
      virtualItems={virtualizer.getVirtualItems()}
      totalSize={virtualizer.getTotalSize()}
    />
  )
}

// Mobile: the document/window is the scroll element (so the URL bar collapses). scrollMargin is the
// list's absolute offset from the top of the document.
function WindowVirtualGrid<T>(props: TanStackVirtualGridProps<T>) {
  // When an item drawer is open on touch, this list becomes the occluded backdrop behind the full-screen
  // item (reparented into a fixed layer). Freeze its measurements so it doesn't re-flow to that box's width
  // and stretch on the swipe-reveal — see useVirtualContainer's `frozen`.
  const itemDrawerOpen = useItemDrawerStore((s) => s.isOpen)
  const { containerRef, cols, scrollMargin } = useVirtualContainer({
    getColumns: props.getColumns,
    windowMode: true,
    frozen: itemDrawerOpen,
  })
  const { rows, effectiveItemHeight, rowHeight } = useGridRows(props, cols, true)
  const virtualizer = useWindowVirtualizer({
    count: rows.length,
    estimateSize: () => rowHeight,
    overscan: 2,
    scrollMargin,
  })

  // Freeze the container HEIGHT too while the item is open. On close the page rejoins document flow and the
  // window scroll is restored to where it was — but if the virtualizer's getTotalSize() momentarily reports
  // a collapsed height (it re-measures from scratch on unfreeze; the document is briefly ~viewport-tall for
  // a few hundred ms), the document isn't tall enough to scroll to the saved position, so the page is stuck
  // flashing at the top until it re-grows. Holding the last document-time total height keeps the container
  // tall across the whole open→close cycle, so the scroll restore lands in a single frame with no flash.
  // Held in state (not a ref) and updated by a render-phase setState — React's supported pattern for
  // deriving state from props/external reads — so the lint rule against render-time ref access is satisfied.
  const liveTotalSize = virtualizer.getTotalSize()
  const [frozenTotalSize, setFrozenTotalSize] = useState(liveTotalSize)
  // Refresh the frozen height from any positive live size while the drawer is closed (normal case), AND
  // on a deep-link open where the store is already `isOpen` at the grid's first measured render — there
  // the seed above captured 0 (the window virtualizer reports 0 before its first measure), and the
  // closed-only guard would latch it there forever, leaving the backdrop with no scrollable height and
  // breaking the close-time scroll restore. So also accept the first non-zero size while open.
  const shouldRefreshFrozen = !itemDrawerOpen || frozenTotalSize === 0
  if (shouldRefreshFrozen && liveTotalSize > 0 && liveTotalSize !== frozenTotalSize) {
    setFrozenTotalSize(liveTotalSize)
  }
  const totalSize = itemDrawerOpen ? frozenTotalSize : liveTotalSize

  return (
    <VirtualGridBody
      {...props}
      containerRef={containerRef}
      cols={cols}
      effectiveItemHeight={effectiveItemHeight}
      scrollMargin={scrollMargin}
      rows={rows}
      virtualItems={virtualizer.getVirtualItems()}
      totalSize={totalSize}
    />
  )
}

interface VirtualGridBodyProps<T> extends TanStackVirtualGridProps<T> {
  containerRef: RefObject<HTMLDivElement | null>
  // The windowed rows + total list height, read from whichever virtualizer is active. Typed as the
  // shared shape both virtualizers expose, so this presentational body is scroller-agnostic.
  virtualItems: VirtualItem[]
  totalSize: number
  rows: (T | 'load-more')[][]
  cols: number
  effectiveItemHeight: number
  scrollMargin: number
}

// Presentational, scroller-agnostic body: absolute-positions each windowed row and runs the
// infinite-scroll trigger. Shared by both the window and element grids above.
function VirtualGridBody<T>({
  containerRef, virtualItems, totalSize, rows, cols, effectiveItemHeight,
  gap = 12, columnGap = gap, rowGap = gap, scrollMargin, isLoading, hasMore, onLoadMore, renderItem,
}: VirtualGridBodyProps<T>) {
  // Infinite scroll: when the trailing `load-more` row is windowed into view, fetch the next page.
  // Guarded by isLoading so it fires once per page; the React Query fetch flips isLoading true
  // immediately, blocking re-entry until the new page lands.
  const lastRowIndex = virtualItems.length > 0 ? virtualItems[virtualItems.length - 1].index : -1
  useEffect(() => {
    if (hasMore && !isLoading && lastRowIndex >= rows.length - 1) {
      onLoadMore()
    }
  }, [hasMore, isLoading, lastRowIndex, rows.length, onLoadMore])

  return (
    <div ref={containerRef} className="relative w-full" style={{ height: `${totalSize}px` }}>
      {virtualItems.map((virtualRow) => {
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
