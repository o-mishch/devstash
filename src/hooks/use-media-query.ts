'use client'

import { useEffect, useState } from 'react'

/**
 * Subscribe to a CSS media query and return whether it currently matches.
 * Returns `false` during SSR and the first client render, then updates on mount —
 * callers must tolerate the initial `false` (overlay content mounts on user
 * interaction, after hydration, so this avoids a hydration mismatch).
 */
export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(false)

  useEffect(() => {
    // matchMedia is the only API for reacting to viewport breakpoints; no
    // framework-level alternative exists, and it is read only inside this effect.
    const mql = window.matchMedia(query)
    const onChange = () => setMatches(mql.matches)
    onChange()
    mql.addEventListener('change', onChange)
    return () => mql.removeEventListener('change', onChange)
  }, [query])

  return matches
}
