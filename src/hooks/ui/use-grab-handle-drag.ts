'use client'

import { useCallback, useEffect, useRef, type RefObject, type TouchEvent } from 'react'
import { FLY_OFF_MS, FLY_OFF_EASE, shouldDismissSwipe, schedulePostDismissCheck } from '@/lib/utils/swipe'

interface UseGrabHandleDragOptions {
  /** Called when the user releases in dismiss mode (at min width + rightward drag, or fast flick). */
  onDismiss: () => void
  /** Called to update drawer width on every move frame (both directions). */
  onResize: (width: number) => void
  /** Current drawer width in px — baseline for resize deltas. */
  drawerWidth: number
  /** Min/max constraints for resize, matching useResizable. */
  minWidth: number
  maxWidth: number
  enabled?: boolean
  /** Ref to the sheet DOM element — used for translateX during dismiss-slide at min width. */
  sheetRef: RefObject<HTMLElement | null>
}

interface GrabHandlers {
  onTouchStart: (e: TouchEvent) => void
  onTouchMove: (e: TouchEvent) => void
  onTouchEnd: () => void
}

interface GrabHandleDragResult {
  handlers: GrabHandlers
}

export function useGrabHandleDrag({
  onDismiss,
  onResize,
  drawerWidth,
  minWidth,
  maxWidth,
  enabled = true,
  sheetRef,
}: UseGrabHandleDragOptions): GrabHandleDragResult {
  const startX = useRef(0)
  const startTime = useRef(0)
  const startWidth = useRef(drawerWidth)
  const active = useRef(false)
  const lastDxRef = useRef(0)
  // True when the gesture entered dismiss-slide mode (dragging right at min width).
  const dismissModeRef = useRef(false)
  // True when the sheet is rendered full-width (mobile `max-sm:!w-full`): there is no room to resize, so a
  // rightward grip drag is ALWAYS a dismiss-slide (not a resize). Captured at touch start from the live DOM
  // width vs the viewport, since the resizable `drawerWidth` state still holds the desktop px on mobile.
  const fullWidthRef = useRef(false)
  const flyOffTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const postDismissRafRef = useRef(0)

  const clearSheetTransform = useCallback(() => {
    const el = sheetRef.current
    if (el) {
      el.style.transform = ''
      el.style.transition = ''
    }
  }, [sheetRef])

  const reset = useCallback(() => {
    active.current = false
    lastDxRef.current = 0
    dismissModeRef.current = false
    clearSheetTransform()
  }, [clearSheetTransform])

  // CONTINUE the close from the release point: slide the sheet the rest of the way off the right edge,
  // THEN commit the close — instead of calling onDismiss() with the sheet snapped back to 0 (the old
  // behaviour, which made the drawer vanish in place with no animation). Reads the sheet's current
  // translateX from the live drag so the fly-off starts exactly where the finger lifted; if there is no
  // live transform (a fast flick during resize never slid the sheet), it starts from 0. The off-screen
  // target is the sheet's own width so it clears the viewport regardless of how wide it is.
  const flyOffAndDismiss = useCallback(() => {
    const el = sheetRef.current
    active.current = false
    lastDxRef.current = 0
    dismissModeRef.current = false
    if (!el) {
      onDismiss()
      return
    }
    const currentX = new DOMMatrixReadOnly(getComputedStyle(el).transform).m41
    const target = el.getBoundingClientRect().width
    // Frame 1: ensure the transition is on at the current position (the drag wrote transition:none).
    el.style.transition = 'none'
    el.style.transform = `translateX(${Math.max(0, currentX)}px)`
    // Force a reflow so the browser paints the start state before the transition target is applied —
    // otherwise it collapses both into one commit and jumps instantly (no animation).
    void el.getBoundingClientRect()
    el.style.transition = `transform ${FLY_OFF_MS}ms ${FLY_OFF_EASE}`
    el.style.transform = `translateX(${target}px)`
    flyOffTimer.current = setTimeout(() => {
      // CRUCIAL: do NOT clear the transform here. The sheet is now off-screen (translateX = width). If we
      // cleared it back to translateX(0) and then called onDismiss(), the Sheet would START its own close
      // from the fully-open position — re-showing the drawer for a frame before sliding it out again (the
      // "~20% reappears then completes closing" jump). Instead we KEEP it parked off-screen and commit the
      // close: the Sheet unmounts from where the fly-off left it, with no snap-back.
      onDismiss()
      // …unless the close was DEFERRED (an unsaved-edit guard opened a discard dialog instead of closing).
      // Then the sheet is still mounted but stranded off-screen. Detect that next frame (still present and
      // not in its closing/ending state) and spring it back into place so the dialog sits over the drawer.
      // Deferred close: spring the sheet back into place over the discard dialog.
      schedulePostDismissCheck(postDismissRafRef, () => sheetRef.current, () => {
        const live = sheetRef.current
        if (live) {
          live.style.transition = `transform ${FLY_OFF_MS}ms ${FLY_OFF_EASE}`
          live.style.transform = 'translateX(0px)'
        }
      })
    }, FLY_OFF_MS)
  }, [sheetRef, onDismiss])

  // Cancel a pending fly-off on unmount so onDismiss can't fire after the drawer is gone.
  useEffect(() => () => {
    if (flyOffTimer.current) clearTimeout(flyOffTimer.current)
    cancelAnimationFrame(postDismissRafRef.current)
  }, [])

  const onTouchStart = useCallback((e: TouchEvent) => {
    if (!enabled || e.touches.length !== 1) return
    startX.current = e.touches[0].clientX
    startTime.current = Date.now()
    startWidth.current = drawerWidth
    active.current = true
    lastDxRef.current = 0
    dismissModeRef.current = false
    // Full-width when the sheet spans (nearly) the whole viewport — the mobile case where the grip drag
    // must dismiss-slide rather than resize. Read live from the DOM (the `drawerWidth` state lags as the
    // desktop px on mobile). document is required: the sheet is portaled outside this hook's subtree.
    // clientWidth excludes the scrollbar; window.innerWidth includes it, which would false-positive on
    // desktop browsers with overlay scrollbars where the sheet is narrower than innerWidth by ~15px.
    const el = sheetRef.current
    fullWidthRef.current = el ? el.getBoundingClientRect().width >= document.documentElement.clientWidth - 1 : false
  }, [enabled, drawerWidth, sheetRef])

  const onTouchMove = useCallback((e: TouchEvent) => {
    if (!enabled || !active.current || e.touches.length !== 1) return
    const dx = e.touches[0].clientX - startX.current
    lastDxRef.current = dx

    if (dx > 0 && (fullWidthRef.current || startWidth.current <= minWidth)) {
      // Dragging right with no room to resize (full-width mobile) OR at min width: slide to signal dismiss.
      dismissModeRef.current = true
      const el = sheetRef.current
      if (el) {
        el.style.transform = `translateX(${dx}px)`
        el.style.transition = 'none'
      }
    } else {
      // Normal resize: left = widen, right = narrow.
      if (dismissModeRef.current) {
        // Reversed back left from dismiss-slide — snap back and continue resizing.
        dismissModeRef.current = false
        clearSheetTransform()
      }
      onResize(Math.min(maxWidth, Math.max(minWidth, startWidth.current - dx)))
    }
  }, [enabled, minWidth, maxWidth, onResize, sheetRef, clearSheetTransform])

  const onTouchEnd = useCallback(() => {
    if (!active.current) return
    const dx = lastDxRef.current

    if (dismissModeRef.current) {
      // Released in dismiss-slide mode: any rightward release dismisses — fly it off from where it sits.
      flyOffAndDismiss()
      return
    }

    if (dx > 0) {
      // Fast rightward flick while resizing → dismiss. No slow-drag limit here (Infinity): slow drags in
      // the resize zone are handled by dismissMode above; only a velocity flick commits a dismiss here.
      const elapsed = Date.now() - startTime.current
      const velocity = dx / Math.max(1, elapsed)
      if (shouldDismissSwipe({ dragged: dx, velocity, limit: Infinity })) {
        flyOffAndDismiss()
        return
      }
    }

    reset()
  }, [flyOffAndDismiss, reset])

  return { handlers: { onTouchStart, onTouchMove, onTouchEnd } }
}
