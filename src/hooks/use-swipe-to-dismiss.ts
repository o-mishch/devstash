'use client'

import { useCallback, useMemo, useRef, useState, type CSSProperties, type TouchEvent } from 'react'

type SwipeDirection = 'left' | 'right' | 'down'

interface SwipeToDismissOptions {
  onDismiss: () => void
  // Which way the panel slides off-screen to close: 'right' for a right-anchored drawer,
  // 'left' for a left-anchored sidebar, 'down' for a bottom sheet.
  direction?: SwipeDirection
  // Dismiss once dragged past this fraction of the element's length (or on a fast flick).
  threshold?: number
  enabled?: boolean
}

interface SwipeHandlers {
  onTouchStart: (e: TouchEvent) => void
  onTouchMove: (e: TouchEvent) => void
  onTouchEnd: () => void
}

interface SwipeToDismissResult {
  // Inline style driving the drag: translate by the current signed offset along the gesture
  // axis, with transition off while dragging so the panel tracks the finger. Spread into `style`.
  dragStyle: CSSProperties
  // Touch handlers to spread onto the panel.
  handlers: SwipeHandlers
}

// Walk up from the touched node to the gesture root (sheet-content). For a horizontal gesture,
// keep (ignore the dismiss) if it began inside Monaco or any horizontally-scrollable region.
// For a vertical gesture, keep it if it began inside a vertical scroller that is NOT at the top
// (scrollTop > 0) — so the body scrolls normally and only a top-edge pull dismisses.
function startedInScroller(target: Element | null, axis: 'x' | 'y'): boolean {
  let el = target
  while (el && el.getAttribute('data-slot') !== 'sheet-content') {
    // A maximized/collapsed editor overlay is portaled out to document.body. This walk follows the
    // real DOM parent chain of the touch target (e.target's ancestors), not the React tree — so we
    // reach here only when the gesture began inside that overlay in the DOM, which means the marker
    // must sit on a DOM ancestor of the target. Treat any such gesture as "keep" so swiping the
    // editor never dismisses the surrounding sheet/drawer — the editor owns its own expand/collapse
    // gesture via its chrome header.
    if (el.hasAttribute('data-editor-overlay')) return true
    if (axis === 'x' && el.classList.contains('monaco-editor')) return true
    const style = getComputedStyle(el)
    if (axis === 'x') {
      if ((style.overflowX === 'auto' || style.overflowX === 'scroll') && el.scrollWidth > el.clientWidth + 1) {
        return true
      }
    } else if (
      (style.overflowY === 'auto' || style.overflowY === 'scroll') &&
      el.scrollHeight > el.clientHeight + 1 &&
      el.scrollTop > 0
    ) {
      return true
    }
    el = el.parentElement
  }
  return false
}

const DIRECTION_LOCK_PX = 8

// Swipe-to-dismiss for an edge-anchored panel. Touch-only by construction (touch events never
// fire for mouse), so it adds nothing to the desktop pointer experience. Commits to dragging
// only once the gesture is clearly along the closing axis and moving toward the closing edge, so
// the cross-axis scroll (and inner scrollers / the code editor) keep working.
export function useSwipeToDismiss({ onDismiss, direction = 'right', threshold = 0.35, enabled = true }: SwipeToDismissOptions): SwipeToDismissResult {
  const axis: 'x' | 'y' = direction === 'down' ? 'y' : 'x'
  // +1 closes by moving right/down, -1 closes by moving left.
  const sign = direction === 'left' ? -1 : 1
  const startX = useRef(0)
  const startY = useRef(0)
  const startTime = useRef(0)
  const size = useRef(0)
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
    const rect = e.currentTarget.getBoundingClientRect()
    size.current = axis === 'x' ? rect.width : rect.height
    phase.current = 'pending'
  }, [enabled, axis])

  const onTouchMove = useCallback((e: TouchEvent) => {
    if (!enabled || phase.current === 'ignore' || e.touches.length !== 1) return
    const touch = e.touches[0]
    const dx = touch.clientX - startX.current
    const dy = touch.clientY - startY.current
    const primary = axis === 'x' ? dx : dy
    const cross = axis === 'x' ? dy : dx

    if (phase.current === 'pending') {
      if (Math.abs(dx) < DIRECTION_LOCK_PX && Math.abs(dy) < DIRECTION_LOCK_PX) return
      // Toward the closing edge (sign) and clearly more along the gesture axis than across it.
      const towardCloseEdge = primary * sign > 0 && Math.abs(primary) > Math.abs(cross) * 1.2
      if (towardCloseEdge && !startedInScroller(e.target as Element, axis)) {
        phase.current = 'drag'
        setDragging(true)
      } else {
        phase.current = 'ignore'
        return
      }
    }

    // Clamp so the panel only moves toward (never past) its anchored edge.
    setDragOffset(sign > 0 ? Math.max(0, primary) : Math.min(0, primary))
  }, [enabled, setDragOffset, sign, axis])

  const onTouchEnd = useCallback(() => {
    if (phase.current !== 'drag') {
      reset()
      return
    }
    const dragged = Math.abs(offsetRef.current)
    const elapsed = Date.now() - startTime.current
    const velocity = dragged / Math.max(1, elapsed) // px per ms
    if (dragged > size.current * threshold || velocity > 0.5) {
      onDismiss()
    }
    reset()
  }, [onDismiss, reset, threshold])

  const dragStyle = useMemo<CSSProperties>(() => {
    if (!offset) return { transition: dragging ? 'none' : undefined }
    const translate = axis === 'x' ? `translateX(${offset}px)` : `translateY(${offset}px)`
    return { transform: translate, transition: dragging ? 'none' : undefined }
  }, [offset, dragging, axis])

  const handlers = useMemo<SwipeHandlers>(
    () => ({ onTouchStart, onTouchMove, onTouchEnd }),
    [onTouchStart, onTouchMove, onTouchEnd],
  )

  return { dragStyle, handlers }
}
