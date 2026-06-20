import { describe, it, expect } from 'vitest'

import { shouldDismissSwipe, SWIPE_FLICK_MIN_PX, SWIPE_FLICK_VELOCITY } from './swipe'

describe('shouldDismissSwipe', () => {
  it('dismisses when dragged past the limit, regardless of velocity', () => {
    expect(shouldDismissSwipe({ dragged: 91, velocity: 0, limit: 90 })).toBe(true)
  })

  it('does not dismiss a slow drag that stops short of the limit', () => {
    expect(shouldDismissSwipe({ dragged: 50, velocity: 0.1, limit: 90 })).toBe(false)
  })

  it('dismisses a fast flick that clears the minimum distance', () => {
    expect(
      shouldDismissSwipe({ dragged: SWIPE_FLICK_MIN_PX + 1, velocity: SWIPE_FLICK_VELOCITY + 0.1, limit: 90 }),
    ).toBe(true)
  })

  it('does NOT dismiss a fast brush that is below the minimum flick distance', () => {
    expect(
      shouldDismissSwipe({ dragged: SWIPE_FLICK_MIN_PX - 1, velocity: SWIPE_FLICK_VELOCITY + 5, limit: 90 }),
    ).toBe(false)
  })

  it('treats the flick velocity threshold as exclusive', () => {
    expect(
      shouldDismissSwipe({ dragged: SWIPE_FLICK_MIN_PX + 10, velocity: SWIPE_FLICK_VELOCITY, limit: 90 }),
    ).toBe(false)
  })

  it('treats the limit as exclusive (equal distance is not enough on its own)', () => {
    expect(shouldDismissSwipe({ dragged: 90, velocity: 0, limit: 90 })).toBe(false)
  })

  it('handles a zero/degenerate gesture without dismissing', () => {
    expect(shouldDismissSwipe({ dragged: 0, velocity: 0, limit: 0 })).toBe(false)
  })
})
