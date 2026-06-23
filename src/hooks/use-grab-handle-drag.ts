'use client'

import { useCallback, useRef, type RefObject, type TouchEvent } from 'react'
import { SWIPE_FLICK_MIN_PX, SWIPE_FLICK_VELOCITY } from '@/lib/utils/swipe'

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

interface GrabHandleDragResult {
  handlers: {
    onTouchStart: (e: TouchEvent) => void
    onTouchMove: (e: TouchEvent) => void
    onTouchEnd: () => void
  }
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

  const onTouchStart = useCallback((e: TouchEvent) => {
    if (!enabled || e.touches.length !== 1) return
    startX.current = e.touches[0].clientX
    startTime.current = Date.now()
    startWidth.current = drawerWidth
    active.current = true
    lastDxRef.current = 0
    dismissModeRef.current = false
  }, [enabled, drawerWidth])

  const onTouchMove = useCallback((e: TouchEvent) => {
    if (!enabled || !active.current || e.touches.length !== 1) return
    const dx = e.touches[0].clientX - startX.current
    lastDxRef.current = dx

    if (dx > 0 && startWidth.current <= minWidth) {
      // At min width and dragging right: slide the sheet to signal dismiss.
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
      // Released in dismiss-slide mode: any rightward release dismisses.
      active.current = false
      lastDxRef.current = 0
      dismissModeRef.current = false
      onDismiss()
      return
    }

    if (dx > 0) {
      // Fast rightward flick while resizing → dismiss.
      const elapsed = Date.now() - startTime.current
      const velocity = dx / Math.max(1, elapsed)
      if (velocity >= SWIPE_FLICK_VELOCITY && dx >= SWIPE_FLICK_MIN_PX) {
        active.current = false
        lastDxRef.current = 0
        onDismiss()
        return
      }
    }

    reset()
  }, [onDismiss, reset])

  return { handlers: { onTouchStart, onTouchMove, onTouchEnd } }
}
