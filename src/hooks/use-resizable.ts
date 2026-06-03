'use client'

import { useState, useEffect, useCallback, type RefObject, type MouseEvent as ReactMouseEvent } from 'react'

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
  dragging: boolean
  startResize: () => void
  onMouseMove: (e: ReactMouseEvent | MouseEvent) => void
  onMouseUp: () => void
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
  const [dragging, setDragging] = useState(false)
  const [boundaryLeft, setBoundaryLeft] = useState(0)

  // Initialize boundary left once on mount
  useEffect(() => {
    const el = maxBoundaryRef?.current ?? (maxBoundarySelector ? document.querySelector(maxBoundarySelector) : null)
    if (el) {
      setBoundaryLeft(el.getBoundingClientRect().left)
    }
  }, [maxBoundaryRef, maxBoundarySelector])

  // Keep boundaryLeft in sync — ResizeObserver fires on sidebar expand/collapse and window resize
  useEffect(() => {
    const el = maxBoundaryRef?.current ?? (maxBoundarySelector ? document.querySelector(maxBoundarySelector) : null)
    if (!el) return
    const ro = new ResizeObserver(() => setBoundaryLeft(el.getBoundingClientRect().left))
    ro.observe(el)
    return () => ro.disconnect()
  }, [maxBoundaryRef, maxBoundarySelector])

  // Derive clamped width during render — no DOM reads needed in any effect
  const vw = typeof window !== 'undefined' ? window.innerWidth : defaultWidth
  const min = Math.max(minPx, Math.round(vw * minVw))
  const max = vw - boundaryLeft - Math.round(vw * maxBoundaryGapVw)
  const width = Math.min(Math.max(rawWidth, min), max)

  const onMouseMove = useCallback((e: ReactMouseEvent | MouseEvent) => {
    if (!dragging) return
    const currentVw = window.innerWidth
    const currentMin = Math.max(minPx, Math.round(currentVw * minVw))
    const currentMax = currentVw - boundaryLeft - Math.round(currentVw * maxBoundaryGapVw)
    setRawWidth(Math.min(Math.max(currentVw - e.clientX, currentMin), currentMax))
  }, [dragging, minPx, minVw, boundaryLeft, maxBoundaryGapVw])

  const onMouseUp = useCallback(() => {
    setDragging(false)
  }, [])

  const startResize = useCallback(() => setDragging(true), [])

  return { width, dragging, startResize, onMouseMove, onMouseUp }
}
