'use client'

import { useCallback, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { motion } from 'motion/react'
import { useMediaQuery } from '@/hooks/use-media-query'

export interface BentoMasonryTile {
  // Stable identity across re-packs — the bucket group name. Drives the Motion key so a tile keeps
  // animating its own (x, y) as the packing changes rather than snapping.
  key: string
  content: ReactNode
}

interface BentoMasonryProps {
  tiles: BentoMasonryTile[]
  // Horizontal + vertical gap between tiles, in px (matches the board's `gap-3` = 12px).
  gap?: number
}

interface TilePosition {
  x: number
  y: number
  width: number
}

// Pack tiles into `columns` columns shortest-column-first (Pinterest/Bento packing), in the tiles'
// given order. Returns each tile's absolute (x, y) plus the total height of the tallest column so the
// container can size itself.
function packTiles(
  tiles: BentoMasonryTile[],
  heights: Map<string, number>,
  columns: number,
  containerWidth: number,
  gap: number,
): { positions: Map<string, TilePosition>; containerHeight: number } {
  const colWidth = columns > 0 ? (containerWidth - gap * (columns - 1)) / columns : containerWidth
  const colHeights = new Array(columns).fill(0)
  const positions = new Map<string, TilePosition>()

  tiles.forEach((tile) => {
    // Shortest column wins; ties go to the left-most column (deterministic, stable across re-packs).
    let target = 0
    colHeights.forEach((h, i) => {
      if (h < colHeights[target]) target = i
    })
    const x = target * (colWidth + gap)
    const y = colHeights[target]
    positions.set(tile.key, { x, y, width: colWidth })
    colHeights[target] = y + (heights.get(tile.key) ?? 0) + gap
  })

  // Drop the trailing gap that each column accumulated past its last tile.
  const containerHeight = Math.max(0, ...colHeights.map((h) => Math.max(0, h - gap)))
  return { positions, containerHeight }
}

/**
 * JS-measured absolute masonry for the Brain Dump Bento buckets. Replaces CSS `columns` (whose
 * cross-column reflow can't be transform-animated) with measured Pinterest packing: each tile is
 * absolutely positioned and animates its (x, y) with Motion, so a bucket growing/shrinking or hopping
 * columns glides instead of snapping.
 *
 * Measurement is **synchronous** in `useLayoutEffect` (read each tile's `offsetHeight` + the container
 * width before the browser paints), so the very first painted frame is already packed — no overlap flash
 * at (0, 0) while async ResizeObservers catch up. A single ResizeObserver per tile (plus one on the
 * container) re-measures on later changes (cards streaming in, drags, viewport resize) and triggers a
 * re-pack. The measure pass keys off `tiles`, `columnCount`, and `containerWidth` so it re-runs whenever
 * the set of tiles or the layout geometry changes.
 */
export function BentoMasonry({ tiles, gap = 12 }: BentoMasonryProps) {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const [containerWidth, setContainerWidth] = useState(0)
  // Live per-tile measured heights, kept in state (not a ref) so packing reads them during render and a
  // height change re-packs. Replaced only when a value actually moves (so packing is stable otherwise).
  const [heights, setHeights] = useState<Map<string, number>>(() => new Map())

  // Each tile's measured wrapper element, by key — populated by the ref callback below and read by the
  // synchronous measure pass. A plain ref (not state): elements are imperative handles, not render input.
  const tileEls = useRef<Map<string, HTMLDivElement>>(new Map())

  // Responsive column count mirrors the prior `columns-1 sm:columns-2 xl:columns-3` breakpoints.
  const isSm = useMediaQuery('(min-width: 640px)')
  const isXl = useMediaQuery('(min-width: 1280px)')
  let columnCount = 1
  if (isXl) columnCount = 3
  else if (isSm) columnCount = 2

  // Merge one tile's measured height into state, no-op if unchanged (avoids a re-pack churn loop).
  const setHeight = useCallback((key: string, height: number) => {
    setHeights((prev) => {
      const current = prev.get(key)
      if (current !== undefined && Math.abs(current - height) <= 0.5) return prev
      const next = new Map(prev)
      next.set(key, height)
      return next
    })
  }, [])

  // Synchronous seed measurement: read the container width and every tile's height before paint, so the
  // first painted frame is already packed. Runs whenever the tile set or geometry changes. Heights are
  // only trusted once the container width is known AND the tiles carry their column width (so a tile's
  // measured height reflects the width it'll actually render at, not the 0-width fallback) — otherwise
  // we only seed the width this pass and let the next (width-known) pass measure heights.
  const tileKeys = tiles.map((t) => t.key).join('|')
  useLayoutEffect(() => {
    const container = containerRef.current
    const width = container?.clientWidth ?? 0
    if (width > 0.5) setContainerWidth((prev) => (Math.abs(prev - width) > 0.5 ? width : prev))
    if (containerWidth > 0) {
      tileEls.current.forEach((el, key) => setHeight(key, el.offsetHeight))
    }
    // Drop heights for tiles that no longer exist so a removed bucket can't hold open container height.
    // Live keys come from `tileKeys` (not `tiles`) so the board can pass a fresh `tiles` array each
    // render without re-triggering this synchronous-measure effect on every render — `tileKeys` already
    // captures the only change that matters (the tile set).
    setHeights((prev) => {
      const live = new Set(tileKeys.split('|'))
      if ([...prev.keys()].every((k) => live.has(k))) return prev
      const next = new Map<string, number>()
      prev.forEach((v, k) => {
        if (live.has(k)) next.set(k, v)
      })
      return next
    })
  }, [tileKeys, columnCount, containerWidth, setHeight])

  // Container ResizeObserver: re-pack on viewport / sidebar width changes.
  useLayoutEffect(() => {
    const el = containerRef.current
    if (!el) return
    const ro = new ResizeObserver((entries) => {
      const width = entries[0]?.contentRect.width ?? 0
      setContainerWidth((prev) => (Math.abs(prev - width) > 0.5 ? width : prev))
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  // Single STABLE per-tile ref callback: it reads the tile key from the element's `data-tile-key` instead
  // of closing over it, so its identity never changes across renders — a fresh closure per render would
  // make React detach/re-observe every tile on every render (observer churn). On attach it observes the
  // element's height (cards streaming in/out, drags). On a removed tile the element leaves the DOM and its
  // observer self-disconnects on the next size callback via the `isConnected` guard; the keyed Maps only
  // ever hold the 6 fixed buckets, so no unbounded growth.
  const observers = useRef<Map<string, ResizeObserver>>(new Map())
  const measureRef = useCallback(
    (el: HTMLDivElement | null) => {
      if (!el) return
      const key = el.dataset.tileKey
      if (!key || observers.current.has(key)) return
      tileEls.current.set(key, el)
      const ro = new ResizeObserver((entries) => {
        if (!el.isConnected) {
          ro.disconnect()
          observers.current.delete(key)
          tileEls.current.delete(key)
          return
        }
        setHeight(key, entries[0]?.contentRect.height ?? el.offsetHeight)
      })
      ro.observe(el)
      observers.current.set(key, ro)
    },
    [setHeight],
  )

  const { positions, containerHeight } = packTiles(tiles, heights, columnCount, containerWidth, gap)
  // Hide tiles until the container has a width and the first measure pass has populated heights — avoids
  // the one-frame overlap at (0, 0) if a layout-effect timing edge slips a paint through.
  const ready = containerWidth > 0

  return (
    <div ref={containerRef} className="relative w-full" style={{ height: ready ? containerHeight : undefined }}>
      {tiles.map((tile) => {
        const pos = positions.get(tile.key)
        return (
          <motion.div
            key={tile.key}
            className="absolute top-0 left-0"
            style={{ width: pos?.width ?? '100%', visibility: ready ? 'visible' : 'hidden' }}
            initial={false}
            animate={{ x: pos?.x ?? 0, y: pos?.y ?? 0 }}
            transition={{ type: 'spring', stiffness: 400, damping: 40, mass: 0.8 }}
          >
            <div ref={measureRef} data-tile-key={tile.key}>{tile.content}</div>
          </motion.div>
        )
      })}
    </div>
  )
}
