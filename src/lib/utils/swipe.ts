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

// Decide whether a swipe gesture should dismiss the panel: either it was dragged past `limit`, or it
// was flicked fast enough AND moved a minimum distance. Pure so the threshold logic can be tested
// without the touch-event plumbing of useSwipeToDismiss.
export function shouldDismissSwipe({ dragged, velocity, limit }: ShouldDismissSwipeParams): boolean {
  if (dragged > limit) return true
  return velocity > SWIPE_FLICK_VELOCITY && dragged > SWIPE_FLICK_MIN_PX
}
