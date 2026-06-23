'use client'

import { useState, useCallback, useSyncExternalStore, type RefObject, type MouseEvent as ReactMouseEvent } from 'react'

interface UseResizableOptions {
  defaultWidth: number
  /** Minimum width in px — floor for the vw-based calculation */
  minPx?: number
  /** Fraction of viewport width for the minimum, e.g. 0.25 = 25vw */
  minVw?: number
  /** Optional React ref for the element whose left edge is the max boundary */
  maxBoundaryRef?: RefObject<HTMLElement | null>
  /** CSS selector fallback for the boundary (needed when bridging portals/server components) */
  maxBoundarySelector?: string
  /** Gap as a fraction of viewport width between drawer and the boundary, e.g. 0.05 = 5vw */
  maxBoundaryGapVw?: number
}

interface UseResizableReturn {
  width: number
  /** Resolved min/max px constraints — pass to useGrabHandleDrag for touch resize. */
  minWidth: number
  maxWidth: number
  dragging: boolean
  startResize: (e: ReactMouseEvent | MouseEvent) => void
  onMouseMove: (e: ReactMouseEvent | MouseEvent) => void
  onMouseUp: () => void
  /** Set width directly (clamped to min/max). Used by touch resize on the grab handle. */
  setWidth: (px: number) => void
}

export function useResizable({
  defaultWidth,
  minPx = 380,
  minVw = 0.25,
  maxBoundaryRef,
  maxBoundarySelector,
  maxBoundaryGapVw = 0.05,
}: UseResizableOptions): UseResizableReturn {
  const [rawWidth, setRawWidth] = useState(defaultWidth)
  const [dragStart, setDragStart] = useState<{ x: number, initialWidth: number } | null>(null)
  const dragging = dragStart !== null

  const getBoundaryEl = useCallback(() => {
    // Justification: Need to find the <main> layout wrapper across React portal boundaries
    return maxBoundaryRef?.current ?? (maxBoundarySelector ? document.querySelector(maxBoundarySelector) : null)
  }, [maxBoundaryRef, maxBoundarySelector])

  const subscribeBoundary = useCallback((callback: () => void) => {
    const el = getBoundaryEl()
    if (!el) return () => {}
    const ro = new ResizeObserver(callback)
    ro.observe(el)
    return () => ro.disconnect()
  }, [getBoundaryEl])

  const getBoundarySnapshot = useCallback(() => {
    const rect = getBoundaryEl()?.getBoundingClientRect()
    return rect ? `${rect.left},${rect.right}` : ''
  }, [getBoundaryEl])

  const boundaryRectStr = useSyncExternalStore(
    subscribeBoundary,
    getBoundarySnapshot,
    () => ''
  )

  const [boundaryLeft, boundaryRight] = boundaryRectStr 
    ? boundaryRectStr.split(',').map(Number) 
    : [0, defaultWidth]

  // The boundary right edge (e.g. main content area) equates to our responsive viewport edge
  const vw = boundaryRight || defaultWidth
  const min = Math.max(minPx, Math.round(vw * minVw))
  const max = vw - boundaryLeft - Math.round(vw * maxBoundaryGapVw)
  const width = Math.min(Math.max(rawWidth, min), max)

  const setWidth = useCallback((px: number) => {
    setRawWidth(Math.min(Math.max(px, min), max))
  }, [min, max])

  const onMouseMove = useCallback((e: ReactMouseEvent | MouseEvent) => {
    if (!dragStart) return
    const deltaX = dragStart.x - e.clientX
    setRawWidth(Math.min(Math.max(dragStart.initialWidth + deltaX, min), max))
  }, [dragStart, min, max])

  const onMouseUp = useCallback(() => {
    setDragStart(null)
  }, [])

  const startResize = useCallback((e: ReactMouseEvent | MouseEvent) => {
    setDragStart({ x: e.clientX, initialWidth: width })
  }, [width])

  return { width, minWidth: min, maxWidth: max, dragging, startResize, onMouseMove, onMouseUp, setWidth }
}
