'use client'

import { useRef, useState } from 'react'
import { useMotionValue, animate, type PanInfo } from 'motion/react'
import { shouldDismissSwipe } from '@/lib/utils/swipe'

interface UseMotionSwipeCloseOptions {
  isSettled: boolean
  editorFullscreen: boolean
  onSwipeCloseStart?: () => void
  requestClose: () => void
  // Called after the fly-off animation completes. Return true if the close was deferred (e.g. a
  // dirty-edit guard opened a dialog) so the panel should spring back to x:0.
  getIsOpen: () => boolean
}

interface UseMotionSwipeCloseResult {
  x: ReturnType<typeof useMotionValue<number>>
  panelRef: React.RefObject<HTMLDivElement | null>
  gripPressed: boolean
  setGripPressed: (pressed: boolean) => void
  dragEnabled: boolean
  handleDrag: (_event: never, info: PanInfo) => void
  handleDragEnd: (_event: never, info: PanInfo) => void
}

// Shared Motion-based swipe-right-to-close for full-screen mobile panels (ItemFullScreenView,
// MobileDraftFullScreenView). Handles drag clamping, fly-off tween, spring-back on deferred close,
// and grip-pill press state. The caller wires the returned values into a <motion.div>.
export function useMotionSwipeClose({
  isSettled,
  editorFullscreen,
  onSwipeCloseStart,
  requestClose,
  getIsOpen,
}: UseMotionSwipeCloseOptions): UseMotionSwipeCloseResult {
  const x = useMotionValue(0)
  const panelRef = useRef<HTMLDivElement>(null)
  const [gripPressed, setGripPressed] = useState(false)

  const dragEnabled = isSettled && !editorFullscreen

  const commitSwipeClose = () => {
    onSwipeCloseStart?.()
    requestClose()
    // Spring back if the close was DEFERRED (dirty-guard opened a discard dialog): the panel is still
    // open and must return to x:0 so the dialog sits over it in place. The caller's getIsOpen() reads
    // the live open state synchronously on the next frame — false for a clean close, true for deferred.
    requestAnimationFrame(() => {
      if (getIsOpen()) animate(x, 0, { type: 'spring', stiffness: 500, damping: 40 })
    })
  }

  // Clamp leftward travel to 0: without dragConstraints (which would race our fly-off animation) we
  // manually prevent the panel from sliding past its left edge during the drag.
  const handleDrag = (_event: never, info: PanInfo) => {
    if (info.offset.x < 0) x.set(0)
  }

  const handleDragEnd = (_event: never, info: PanInfo) => {
    if (shouldDismissSwipe({ dragged: info.offset.x, velocity: info.velocity.x / 1000, limit: 90 })) {
      // Fly the panel off the right edge from the current release point, then commit.
      const target = panelRef.current?.offsetWidth ?? x.get() + 1
      const remaining = Math.max(0, target - x.get())
      const duration = target > 0 ? Math.min(0.32, 0.18 + (remaining / target) * 0.16) : 0.18
      animate(x, target, { type: 'tween', ease: [0.32, 0.72, 0, 1], duration, onComplete: commitSwipeClose })
      return
    }
    animate(x, 0, { type: 'spring', stiffness: 500, damping: 40 })
  }

  return { x, panelRef, gripPressed, setGripPressed, dragEnabled, handleDrag, handleDragEnd }
}
