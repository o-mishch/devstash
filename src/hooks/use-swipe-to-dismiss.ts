'use client'

import { useCallback, useMemo, useRef, useState, type CSSProperties, type TouchEvent } from 'react'

type SwipeDirection = 'left' | 'right'

interface SwipeToDismissOptions {
  onDismiss: () => void
  // Which way the panel slides off-screen to close: 'right' for a right-anchored drawer,
  // 'left' for a left-anchored sidebar.
  direction?: SwipeDirection
  // Dismiss once dragged past this fraction of the element's width (or on a fast flick).
  threshold?: number
  enabled?: boolean
}

interface SwipeHandlers {
  onTouchStart: (e: TouchEvent) => void
  onTouchMove: (e: TouchEvent) => void
  onTouchEnd: () => void
}

interface SwipeToDismissResult {
  // Inline style driving the drag: translateX by the current signed offset, with transition
  // off while dragging so the panel tracks the finger. Spread into the panel's `style`.
  dragStyle: CSSProperties
  // Touch handlers to spread onto the panel.
  handlers: SwipeHandlers
}

// Walk up from the touched node to the gesture root; keep (ignore) the gesture if it began
// inside Monaco or any horizontally-scrollable region, so their own panning still works.
function startedInHorizontalScroller(target: Element | null): boolean {
  let el = target
  while (el && el.getAttribute?.('data-slot') !== 'sheet-content') {
    if (el.classList?.contains('monaco-editor')) return true
    const { overflowX } = getComputedStyle(el)
    if ((overflowX === 'auto' || overflowX === 'scroll') && el.scrollWidth > el.clientWidth + 1) {
      return true
    }
    el = el.parentElement
  }
  return false
}

const DIRECTION_LOCK_PX = 8

// Swipe-to-dismiss for an edge-anchored panel. Touch-only by construction (touch events never
// fire for mouse), so it adds nothing to the desktop pointer experience. Commits to dragging
// only once the gesture is clearly horizontal and moving toward the closing edge, so vertical
// scrolling and inner horizontal scrollers (the code editor) keep working.
export function useSwipeToDismiss({ onDismiss, direction = 'right', threshold = 0.35, enabled = true }: SwipeToDismissOptions): SwipeToDismissResult {
  // +1 closes by moving right, -1 closes by moving left.
  const sign = direction === 'right' ? 1 : -1
  const startX = useRef(0)
  const startY = useRef(0)
  const startTime = useRef(0)
  const width = useRef(0)
  const phase = useRef<'pending' | 'drag' | 'ignore'>('pending')
  // Mirror the offset in a ref so onTouchEnd always reads the latest value, independent of
  // React's render timing between touchmove and touchend.
  const offsetRef = useRef(0)
  const [offset, setOffset] = useState(0)
  const [dragging, setDragging] = useState(false)

  const setDragOffset = useCallback((value: number) => {
    offsetRef.current = value
    setOffset(value)
  }, [])

  const reset = useCallback(() => {
    phase.current = 'pending'
    setDragging(false)
    setDragOffset(0)
  }, [setDragOffset])

  const onTouchStart = useCallback((e: TouchEvent) => {
    if (!enabled || e.touches.length !== 1) return
    const touch = e.touches[0]
    startX.current = touch.clientX
    startY.current = touch.clientY
    startTime.current = Date.now()
    width.current = e.currentTarget.getBoundingClientRect().width
    phase.current = 'pending'
  }, [enabled])

  const onTouchMove = useCallback((e: TouchEvent) => {
    if (!enabled || phase.current === 'ignore' || e.touches.length !== 1) return
    const touch = e.touches[0]
    const dx = touch.clientX - startX.current
    const dy = touch.clientY - startY.current

    if (phase.current === 'pending') {
      if (Math.abs(dx) < DIRECTION_LOCK_PX && Math.abs(dy) < DIRECTION_LOCK_PX) return
      // Toward the closing edge (sign) and clearly more horizontal than vertical.
      const towardCloseEdge = dx * sign > 0 && Math.abs(dx) > Math.abs(dy) * 1.2
      if (towardCloseEdge && !startedInHorizontalScroller(e.target as Element)) {
        phase.current = 'drag'
        setDragging(true)
      } else {
        phase.current = 'ignore'
        return
      }
    }

    // Clamp so the panel only moves toward (never past) its anchored edge.
    setDragOffset(sign > 0 ? Math.max(0, dx) : Math.min(0, dx))
  }, [enabled, setDragOffset, sign])

  const onTouchEnd = useCallback(() => {
    if (phase.current !== 'drag') {
      reset()
      return
    }
    const dragged = Math.abs(offsetRef.current)
    const elapsed = Date.now() - startTime.current
    const velocity = dragged / Math.max(1, elapsed) // px per ms
    if (dragged > width.current * threshold || velocity > 0.5) {
      onDismiss()
    }
    reset()
  }, [onDismiss, reset, threshold])

  const dragStyle = useMemo<CSSProperties>(() => ({
    transform: offset ? `translateX(${offset}px)` : undefined,
    transition: dragging ? 'none' : undefined,
  }), [offset, dragging])

  const handlers = useMemo<SwipeHandlers>(
    () => ({ onTouchStart, onTouchMove, onTouchEnd }),
    [onTouchStart, onTouchMove, onTouchEnd],
  )

  return { dragStyle, handlers }
}
