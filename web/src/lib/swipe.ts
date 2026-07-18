interface ShouldDismissSwipeParams {
  /** Absolute px the panel was dragged toward its closing edge at release. */
  dragged: number
  /** Drag speed in px/ms at release. */
  velocity: number
  /** Distance past which a slow, deliberate drag dismisses. */
  limit: number
}

// A flick must still clear this much distance to dismiss, so a fast brush on a small grab handle
// can't close the panel by velocity alone.
export const SWIPE_FLICK_MIN_PX = 24
/** Drag speed (px/ms) above which a short flick dismisses, provided it also cleared the min px. */
export const SWIPE_FLICK_VELOCITY = 0.5
/** How long the panel takes to finish sliding off-screen once a dismiss is decided (ms). */
export const FLY_OFF_MS = 260
// The app's signature slide curve, shared with the CSS chrome transitions (sheet slide, sidebar
// collapse) so a swipe-driven close decelerates exactly like a click-driven one.
export const FLY_OFF_EASE = 'cubic-bezier(0.32, 0.72, 0, 1)'

/**
 * Decide whether a swipe should dismiss: either it was dragged past `limit`, or it was flicked
 * fast enough AND moved a minimum distance.
 */
export function shouldDismissSwipe({
  dragged,
  velocity,
  limit,
}: ShouldDismissSwipeParams): boolean {
  if (dragged > limit) return true
  return velocity > SWIPE_FLICK_VELOCITY && dragged > SWIPE_FLICK_MIN_PX
}
