'use client'

import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type TouchEvent } from 'react'

import { shouldDismissSwipe, schedulePostDismissCheck, FLY_OFF_MS, FLY_OFF_EASE } from '@/lib/utils/swipe'
import { SHEET_CONTENT_SELECTOR } from '@/lib/dom/drawer-selectors'

type SwipeDirection = 'left' | 'right' | 'down'

interface SwipeToDismissOptions {
  onDismiss: () => void
  // Which way the panel slides off-screen to close: 'right' for a right-anchored drawer,
  // 'left' for a left-anchored sidebar, 'down' for a bottom sheet.
  direction?: SwipeDirection
  // Dismiss once dragged past this fraction of the element's length (or on a fast flick).
  threshold?: number
  // Absolute px distance to dismiss, overriding the fraction-of-element-length `threshold`. Use when
  // the gesture can start on a small element (e.g. a grab handle) whose width would make the
  // fractional threshold far too sensitive.
  distanceThreshold?: number
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
export function useSwipeToDismiss({ onDismiss, direction = 'right', threshold = 0.35, distanceThreshold, enabled = true }: SwipeToDismissOptions): SwipeToDismissResult {
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
  // True from the moment a dismiss is decided until onDismiss fires: the panel keeps its current offset
  // and animates the REST of the way off-screen (transition on, not snapping back to 0), so the close
  // visibly continues from where the finger lifted instead of vanishing in place.
  const [flyingOff, setFlyingOff] = useState(false)
  const flyOffTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const flyOffStartRaf = useRef(0)
  // Separate ref for the rAF scheduled INSIDE the fly-off timer callback. If the component unmounts
  // while the timer is still pending, cleanup (below) cancels both the timer and any already-scheduled
  // rAF. If cleanup runs while the timer is in-flight (unmount between timer start and its callback),
  // the rAF scheduled inside the callback fires after cleanup — it cannot be pre-cancelled. React 18
  // no-ops setState on unmounted components, so setDragOffset(0) in that case is a safe no-op.
  const postDismissRafRef = useRef(0)

  const setDragOffset = useCallback((value: number) => {
    offsetRef.current = value
    setOffset(value)
  }, [])

  const reset = useCallback(() => {
    if (flyOffStartRaf.current) {
      cancelAnimationFrame(flyOffStartRaf.current)
      flyOffStartRaf.current = 0
    }
    phase.current = 'pending'
    setDragging(false)
    setFlyingOff(false)
    setDragOffset(0)
  }, [setDragOffset])

  // Clear any pending fly-off timer/rAF on unmount so onDismiss can't fire after the panel is gone.
  useEffect(() => () => {
    if (flyOffTimer.current) clearTimeout(flyOffTimer.current)
    if (flyOffStartRaf.current) cancelAnimationFrame(flyOffStartRaf.current)
    if (postDismissRafRef.current) cancelAnimationFrame(postDismissRafRef.current)
  }, [])

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
    const limit = distanceThreshold ?? size.current * threshold
    if (shouldDismissSwipe({ dragged, velocity, limit })) {
      // CONTINUE the close from the release point: fly the panel the rest of the way off-screen (full
      // length along the closing axis), with the transition on, THEN commit the close. Without this the
      // old code called onDismiss() and reset() together — snapping the offset back to 0 the same frame
      // the sheet closed, so the drawer vanished in place instead of sliding out (the reported bug).
      //
      // The fly-off MUST be split across two frames. The drag frames painted with `transition: none`; a
      // CSS transition only fires when the property changes BETWEEN two painted states. So frame 1 turns
      // the transition ON while holding the current offset (paints the start), and frame 2 (next rAF)
      // moves the offset to the off-screen target — only then does the browser interpolate. Setting both
      // in one commit lets the browser collapse them and jump instantly (no animation) — the device-
      // dependent "just disappeared" we saw, which a synthetic test's frame cadence happened to mask.
      setDragging(false) // re-enable the CSS transition (frame 1 holds the current offset)
      setFlyingOff(true)
      const target = sign * size.current
      flyOffStartRaf.current = requestAnimationFrame(() => {
        setDragOffset(target) // frame 2: now interpolate to off-screen
      })
      flyOffTimer.current = setTimeout(() => {
        // Commit the close but DON'T reset the offset to 0 — the panel is now parked off-screen. Resetting
        // here would snap the transform back to translateX(0) the same frame base-ui starts its own close,
        // re-showing the drawer for a frame before it slides out again (the "~20% reappears then completes"
        // jump). The Sheet unmounts on close from where the fly-off left it; the next open mounts fresh.
        onDismiss()
        // …unless the close was DEFERRED (an unsaved-edit guard opened a discard dialog instead of closing):
        // the panel is still mounted but stranded off-screen. Detect that next frame (the right-side sheet
        // is still present and not in its closing/ending state) and spring the offset back so the dialog
        // sits over the drawer in place. document query: the Sheet is portaled outside this subtree.
        // Deferred close: spring back into place, then drop gesture state once settled.
        schedulePostDismissCheck(postDismissRafRef, () => document.querySelector(SHEET_CONTENT_SELECTOR), () => {
          setDragOffset(0)
          phase.current = 'pending'
          flyOffTimer.current = setTimeout(() => setFlyingOff(false), FLY_OFF_MS)
        })
      }, FLY_OFF_MS)
      return
    }
    reset()
  }, [onDismiss, reset, setDragOffset, sign, threshold, distanceThreshold])

  const dragStyle = useMemo<CSSProperties>(() => {
    // During the fly-off, drive an explicit transform transition so the panel slides the rest of the way
    // off-screen (the Sheet has no transform transition of its own, so without this the offset jump would
    // be instant). While actively dragging, transition is off so the panel tracks the finger 1:1.
    const transition = flyingOff ? `transform ${FLY_OFF_MS}ms ${FLY_OFF_EASE}` : dragging ? 'none' : undefined
    if (!offset) return { transition }
    const translate = axis === 'x' ? `translateX(${offset}px)` : `translateY(${offset}px)`
    return { transform: translate, transition }
  }, [offset, dragging, flyingOff, axis])

  const handlers = useMemo<SwipeHandlers>(
    () => ({ onTouchStart, onTouchMove, onTouchEnd }),
    [onTouchStart, onTouchMove, onTouchEnd],
  )

  return { dragStyle, handlers }
}
