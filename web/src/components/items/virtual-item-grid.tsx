// react-virtual's virtualizer keeps mutable internal state that the React Compiler's memoization
// can stale-cache (measurements read one render behind), so this file opts out per the library's
// guidance. Everything else in web/ stays compiled.
'use no memo'

import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { ReactElement } from 'react'
import { Loader2 } from 'lucide-react'
import { useWindowVirtualizer } from '@tanstack/react-virtual'
import type { LightItem } from '@/client'
import { ItemCard } from './item-card'

// Mirrors the CARD_GRID breakpoints (`sm:grid-cols-2 xl:grid-cols-3`) so the virtualized layout
// lines up column-for-column with the static grids used elsewhere (dashboard, collections).
function columnsForWidth(width: number): number {
  if (width < 640) return 1
  if (width < 1280) return 2
  return 3
}

interface VirtualItemGridProps {
  items: LightItem[]
  hasNextPage: boolean
  isFetchingNextPage: boolean
  fetchNextPageError: boolean
  fetchNextPage: () => void
}

/**
 * Window-virtualized item grid for the full-page lists (`/items/[type]`, `/favorites`,
 * a collection's items). The app shell scrolls the document — not an inner overflow box — so this
 * binds to the window virtualizer and offsets rows by the grid's own document offset (`scrollMargin`).
 * Row heights vary (tags, preview lines), so each row is measured with `measureElement` rather than
 * assumed fixed. A trailing sentinel row drives infinite-scroll fetching as it windows into view.
 */
export function VirtualItemGrid({
  items,
  hasNextPage,
  isFetchingNextPage,
  fetchNextPageError,
  fetchNextPage,
}: VirtualItemGridProps): ReactElement {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const [cols, setCols] = useState(3)
  const [scrollMargin, setScrollMargin] = useState(0)

  // Track the container's width (→ column count) and its offset from the top of the document
  // (→ scrollMargin). Both shift on resize and when content above the grid reflows, so remeasure
  // on a ResizeObserver (width) plus a window resize listener (offset).
  useLayoutEffect(() => {
    const el = containerRef.current
    if (el === null) return undefined
    const measure = (): void => {
      setCols(columnsForWidth(el.offsetWidth))
      // getBoundingClientRect().top is viewport-relative; window.scrollY converts it to the
      // document-relative offset the window virtualizer's scrollMargin expects — no framework
      // equivalent for the current scroll position exists.
      setScrollMargin(el.getBoundingClientRect().top + window.scrollY)
    }
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(el)
    // No React-level "window resized" event exists; a resize can change content above the grid's
    // reflow (and thus its document offset), so the listener is the only way to catch that.
    window.addEventListener('resize', measure)
    return (): void => {
      observer.disconnect()
      window.removeEventListener('resize', measure)
    }
  }, [])

  const rowCount = Math.ceil(items.length / cols)
  // One extra sentinel row while more pages remain; its windowing-in triggers the next fetch.
  const virtualCount = rowCount + (hasNextPage ? 1 : 0)

  const virtualizer = useWindowVirtualizer({
    count: virtualCount,
    estimateSize: () => 172,
    overscan: 3,
    scrollMargin,
  })

  const virtualRows = virtualizer.getVirtualItems()
  const lastIndex = virtualRows.at(-1)?.index ?? -1

  // Infinite scroll: fetch once the last data row (`rowCount - 1`, one before the sentinel) is
  // windowed in, so the next page is in flight before the sentinel scrolls into view. Guarded by
  // isFetchingNextPage (fires once per page) and fetchNextPageError (a failed page shows a manual
  // Retry instead of hammering the endpoint in a loop). `fetchNextPage` is void-returning here —
  // the caller (item-list.tsx) already wraps the underlying TanStack Query promise with
  // `void query.fetchNextPage()`, so there is no rejection to handle at this layer. That inline
  // arrow is recreated on every parent render, so `fetchNextPage` is NOT stable — it's still
  // listed in the dependency array below (correctness first), which just means this effect
  // re-runs on every render; harmless since the guards above make it a no-op unless the sentinel
  // is actually in view and eligible to fetch.
  useEffect(() => {
    if (hasNextPage && !isFetchingNextPage && !fetchNextPageError && lastIndex >= rowCount - 1) {
      fetchNextPage()
    }
  }, [hasNextPage, isFetchingNextPage, fetchNextPageError, lastIndex, rowCount, fetchNextPage])

  return (
    <div
      ref={containerRef}
      className="relative w-full"
      // oxlint-disable-next-line react/forbid-dom-props -- virtualizer-computed total height
      style={{ height: virtualizer.getTotalSize() }}
    >
      {virtualRows.map((virtualRow) => {
        const isSentinel = virtualRow.index >= rowCount
        const start = virtualRow.index * cols
        const rowItems = items.slice(start, start + cols)
        return (
          <div
            key={virtualRow.key}
            data-index={virtualRow.index}
            ref={virtualizer.measureElement}
            className="absolute left-0 top-0 w-full"
            // oxlint-disable-next-line react/forbid-dom-props -- virtual row offset transform
            style={{ transform: `translateY(${virtualRow.start - scrollMargin}px)` }}
          >
            {/* pb-3 supplies the inter-row gap while remaining inside the measured height, so the
                virtualizer accounts for it (matches CARD_GRID's gap-3). */}
            <div className="pb-3">
              {isSentinel ? (
                <SentinelRow
                  fetchNextPageError={fetchNextPageError}
                  fetchNextPage={fetchNextPage}
                />
              ) : (
                <div
                  className="grid gap-3"
                  // oxlint-disable-next-line react/forbid-dom-props -- dynamic responsive column count
                  style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))` }}
                >
                  {rowItems.map((item) => (
                    <ItemCard key={item.id} item={item} />
                  ))}
                </div>
              )}
            </div>
          </div>
        )
      })}
    </div>
  )
}

interface SentinelRowProps {
  fetchNextPageError: boolean
  fetchNextPage: () => void
}

/** The trailing infinite-scroll row: a manual Retry link on error, otherwise a loading spinner. */
function SentinelRow({ fetchNextPageError, fetchNextPage }: SentinelRowProps): ReactElement {
  return (
    <div className="flex justify-center py-4 text-sm text-muted-foreground">
      {fetchNextPageError ? (
        <button
          type="button"
          onClick={fetchNextPage}
          className="text-destructive underline underline-offset-2 hover:text-destructive/80"
        >
          Couldn’t load more. Retry
        </button>
      ) : (
        <Loader2 className="size-4 animate-spin" />
      )}
    </div>
  )
}
