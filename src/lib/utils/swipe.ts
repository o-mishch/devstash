interface ShouldDismissSwipeParams {
  // Absolute px the panel was dragged toward its closing edge at release.
  dragged: number
  // Drag speed in px/ms at release.
  velocity: number
  // Distance past which a slow, deliberate drag dismisses (fraction-of-length or an absolute override).
  limit: number
}

// A flick must still clear this much distance to dismiss, so a fast brush on a small grab handle
// can't close the panel by velocity alone.
export const SWIPE_FLICK_MIN_PX = 24
// Drag speed (px/ms) above which a short flick can dismiss, provided it also cleared SWIPE_FLICK_MIN_PX.
export const SWIPE_FLICK_VELOCITY = 0.5
// How long the panel takes to finish sliding off-screen after a dismiss is decided (ms). Shared by all
// swipe-close hooks so the flyoff duration/easing is consistent regardless of which gesture commits it.
export const FLY_OFF_MS = 260
export const FLY_OFF_EASE = 'cubic-bezier(0.32, 0.72, 0, 1)'

// Decide whether a swipe gesture should dismiss the panel: either it was dragged past `limit`, or it
// was flicked fast enough AND moved a minimum distance. Pure so the threshold logic can be tested
// without the touch-event plumbing of useSwipeToDismiss.
export function shouldDismissSwipe({ dragged, velocity, limit }: ShouldDismissSwipeParams): boolean {
  if (dragged > limit) return true
  return velocity > SWIPE_FLICK_VELOCITY && dragged > SWIPE_FLICK_MIN_PX
}

// After onDismiss() fires, the close may be DEFERRED — an unsaved-edit guard opened a discard dialog
// instead of actually closing, leaving the panel mounted off-screen. Schedule a rAF to detect this: if
// the target element is still in the DOM and not in its closing/ending state, call `onDeferred` so the
// caller can spring the panel back into place over the dialog. Shared by useSwipeToDismiss and
// useGrabHandleDrag so the detection logic lives in one place.
export function schedulePostDismissCheck(
  rafRef: { current: number },
  getEl: () => Element | null,
  onDeferred: () => void,
): void {
  rafRef.current = requestAnimationFrame(() => {
    const el = getEl()
    if (el && !el.hasAttribute('data-ending-style')) onDeferred()
  })
}
