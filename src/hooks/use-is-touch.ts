'use client'

import { useSyncExternalStore } from 'react'

// Must mirror the `@custom-variant touch` in globals.css (coarse pointer OR < lg width).
// matchMedia cannot consume a CSS variant, so this string is the JS twin and the two must
// be kept in sync — `max-width: 1023.98px` is the px equivalent of the variant's `width < 64rem`.
const TOUCH_MEDIA_QUERY = '(pointer: coarse), (max-width: 1023.98px)'

// window.matchMedia is the only API for evaluating a media query in JS — needed when a
// value must be a number/boolean (Monaco editor options, the virtualizer's row height),
// not a CSS-variant-able value. Subscribed via useSyncExternalStore (the idiomatic way to
// read an external store like matchMedia).
function subscribe(onChange: () => void) {
  const mql = window.matchMedia(TOUCH_MEDIA_QUERY)
  mql.addEventListener('change', onChange)
  return () => mql.removeEventListener('change', onChange)
}
const getSnapshot = () => window.matchMedia(TOUCH_MEDIA_QUERY).matches
const getServerSnapshot = () => false

// True when the `touch` variant is active (coarse pointer OR viewport < lg), so JS can
// branch on the same condition as the CSS `touch:` variant.
export function useIsTouch(): boolean {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot)
}
