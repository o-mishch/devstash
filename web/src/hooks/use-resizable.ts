import { useCallback, useState, useSyncExternalStore } from 'react'
import type { MouseEvent as ReactMouseEvent, RefObject } from 'react'

interface UseResizableOptions {
  defaultWidth: number
  /** Minimum width in px — the floor for the vw-based calculation. */
  minPx?: number
  /** Fraction of the boundary width used as the minimum, e.g. 0.25 = 25vw. */
  minVw?: number
  /** Ref for the element whose left edge is the max boundary. */
  maxBoundaryRef?: RefObject<HTMLElement | null>
  /** Selector fallback for the boundary — needed when the panel is portaled out of the tree. */
  maxBoundarySelector?: string
  /** Gap between the panel and the boundary, as a fraction of the boundary width. */
  maxBoundaryGapVw?: number
}

interface UseResizableReturn {
  width: number
  /** Resolved min/max px constraints — also drive the handle's aria-valuemin/max. */
  minWidth: number
  maxWidth: number
  dragging: boolean
  startResize: (e: ReactMouseEvent | MouseEvent) => void
  onMouseMove: (e: ReactMouseEvent | MouseEvent) => void
  onMouseUp: () => void
  /** Set the width directly, clamped to min/max. Used by keyboard resizing. */
  setWidth: (px: number) => void
}

interface DragStart {
  x: number
  initialWidth: number
}

/**
 * Pointer-driven width resizing for a right-side panel, clamped between a vw-scaled minimum and a
 * boundary element's left edge.
 *
 * The width is deliberately session-only (plain state, not persisted) — matching the legacy app,
 * where reopening the drawer always returns to `defaultWidth`.
 */
export function useResizable({
  defaultWidth,
  minPx = 380,
  minVw = 0.25,
  maxBoundaryRef,
  maxBoundarySelector,
  maxBoundaryGapVw = 0.05,
}: UseResizableOptions): UseResizableReturn {
  const [rawWidth, setRawWidth] = useState(defaultWidth)
  const [dragStart, setDragStart] = useState<DragStart | null>(null)
  const dragging = dragStart !== null

  const getBoundaryEl = useCallback((): HTMLElement | null => {
    // document.querySelector is required to find the <main> layout wrapper: the panel is portaled
    // out of this component's subtree, so a ref can't be threaded to it.
    if (maxBoundaryRef?.current) return maxBoundaryRef.current
    return maxBoundarySelector === undefined
      ? null
      : document.querySelector<HTMLElement>(maxBoundarySelector)
  }, [maxBoundaryRef, maxBoundarySelector])

  // The boundary's rect is external, mutable DOM state — useSyncExternalStore + ResizeObserver
  // keeps the clamp correct as the window (or the sidebar rail) resizes. Serialized to a string
  // so the snapshot is comparable by value; returning a fresh object would loop forever.
  const subscribeBoundary = useCallback(
    (onChange: () => void): (() => void) => {
      const el = getBoundaryEl()
      if (el === null) return () => undefined
      const observer = new ResizeObserver(onChange)
      observer.observe(el)
      return () => {
        observer.disconnect()
      }
    },
    [getBoundaryEl],
  )

  const getBoundarySnapshot = useCallback((): string => {
    const rect = getBoundaryEl()?.getBoundingClientRect()
    return rect ? `${String(rect.left)},${String(rect.right)}` : ''
  }, [getBoundaryEl])

  const boundaryRectStr = useSyncExternalStore(subscribeBoundary, getBoundarySnapshot, () => '')

  const [boundaryLeft = 0, boundaryRight = defaultWidth] =
    boundaryRectStr === '' ? [] : boundaryRectStr.split(',').map(Number)

  // The boundary's right edge stands in for the usable viewport edge.
  const vw = boundaryRight || defaultWidth
  const min = Math.max(minPx, Math.round(vw * minVw))
  const max = vw - boundaryLeft - Math.round(vw * maxBoundaryGapVw)
  const width = Math.min(Math.max(rawWidth, min), max)

  const setWidth = useCallback(
    (px: number): void => {
      setRawWidth(Math.min(Math.max(px, min), max))
    },
    [min, max],
  )

  const onMouseMove = useCallback(
    (e: ReactMouseEvent | MouseEvent): void => {
      if (dragStart === null) return
      // The handle is on the panel's left edge, so dragging left (smaller clientX) widens it.
      const deltaX = dragStart.x - e.clientX
      setRawWidth(Math.min(Math.max(dragStart.initialWidth + deltaX, min), max))
    },
    [dragStart, min, max],
  )

  const onMouseUp = useCallback((): void => {
    setDragStart(null)
  }, [])

  const startResize = useCallback(
    (e: ReactMouseEvent | MouseEvent): void => {
      setDragStart({ x: e.clientX, initialWidth: width })
    },
    [width],
  )

  return {
    width,
    minWidth: min,
    maxWidth: max,
    dragging,
    startResize,
    onMouseMove,
    onMouseUp,
    setWidth,
  }
}
