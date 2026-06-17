'use client'

import { useSyncExternalStore } from 'react'

export interface VisualViewportMetrics {
  width: number
  height: number
  offsetTop: number
  offsetLeft: number
  // Height of the on-screen keyboard (and any other bottom inset): the slice of the layout
  // viewport hidden below the visual viewport. 0 when no keyboard is shown.
  keyboardHeight: number
}

// Cached snapshot so getSnapshot returns a referentially-stable object between changes —
// useSyncExternalStore requires equal references when nothing changed, or it re-renders in a loop.
// Module-level is correct here: visualViewport is a single global the whole app observes.
let cached: VisualViewportMetrics | null = null

// window.visualViewport is the only API exposing the keyboard-adjusted viewport; there is no
// React/Next or library equivalent. The keyboard inset is (layout viewport height − visible slice −
// top offset). For the layout-viewport reference we take MAX(innerHeight, documentElement.clientHeight):
// on most platforms innerHeight is the full layout viewport, but some iOS versions shrink innerHeight
// with the keyboard while clientHeight stays full — taking the max keeps the inset non-zero there
// instead of collapsing to 0 (which would leave the focused field hidden behind the keyboard).
function getSnapshot(): VisualViewportMetrics | null {
  const vv = window.visualViewport
  if (!vv) return null
  const layoutViewportHeight = Math.max(window.innerHeight, document.documentElement.clientHeight)
  const next: VisualViewportMetrics = {
    width: vv.width,
    height: vv.height,
    offsetTop: vv.offsetTop,
    offsetLeft: vv.offsetLeft,
    keyboardHeight: Math.max(0, layoutViewportHeight - vv.height - vv.offsetTop),
  }
  if (
    cached &&
    cached.width === next.width &&
    cached.height === next.height &&
    cached.offsetTop === next.offsetTop &&
    cached.offsetLeft === next.offsetLeft &&
    cached.keyboardHeight === next.keyboardHeight
  ) {
    return cached
  }
  cached = next
  return next
}

const getServerSnapshot = (): VisualViewportMetrics | null => null

function subscribe(onChange: () => void): () => void {
  const vv = window.visualViewport
  if (!vv) return () => {}
  vv.addEventListener('resize', onChange)
  vv.addEventListener('scroll', onChange)
  return () => {
    vv.removeEventListener('resize', onChange)
    vv.removeEventListener('scroll', onChange)
  }
}

// Tracks the browser visual viewport — its size, offset, and the on-screen-keyboard inset — so
// fixed overlays can pin themselves to the *visible* region instead of the layout viewport, which
// iOS pans out from under the keyboard (cutting off borders, hiding inputs). Subscribed via
// useSyncExternalStore (React's primitive for external browser stores — same shape as useIsTouch).
// Returns null on the server and until the first client read; callers fall back to a static layout.
export function useVisualViewport(): VisualViewportMetrics | null {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot)
}
