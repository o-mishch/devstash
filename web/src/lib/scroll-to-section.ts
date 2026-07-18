import type { MouseEvent } from 'react'

// Resolve the scroll animation to the OS "reduce motion" preference — 'smooth' for
// everyone else. Shared by the router's hash-scroll/restoration config (resolved once
// at startup) and the logo's scroll-to-top (resolved per click). `window` is absent
// during prerender, where scroll behavior is irrelevant, so default to 'smooth' there.
export function preferredScrollBehavior(): ScrollBehavior {
  if (typeof window === 'undefined') return 'smooth'
  // Justification: matchMedia is a native browser global with no React/TanStack alternative.
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth'
}

// Scroll back to the top of the page — used by the DevStash logo, which already sits
// on the homepage. Section links (Features/Pricing) use `<Link hash>` + the router's
// built-in hash scrolling instead; this is the one code-initiated scroll with no hash
// target to navigate to.
export function scrollToTop(event: MouseEvent<HTMLAnchorElement>): void {
  event.preventDefault()
  // Justification: scrollTo is a native browser global with no React/TanStack alternative.
  window.scrollTo({ top: 0, behavior: preferredScrollBehavior() })
  // Drop any lingering section hash from the URL without reloading.
  // Justification: location/history APIs are native browser globals with no React/TanStack alternative.
  window.history.replaceState(null, '', window.location.pathname)
}
