import { useCallback, useRef, useSyncExternalStore } from 'react'

const getServerSnapshot = (): boolean => false

/**
 * Subscribe to a CSS media query and return whether it currently matches.
 *
 * Returns `false` during the dev server's SSR pass and the first client render, then updates on
 * mount — callers must tolerate the initial `false`. That is safe for overlay content, which mounts
 * on user interaction (after hydration), and avoids a hydration mismatch.
 */
export function useMediaQuery(query: string): boolean {
  // One MediaQueryList per subscription lifetime, shared by subscribe and getSnapshot.
  const mqlRef = useRef<MediaQueryList | null>(null)

  const subscribe = useCallback(
    (onChange: () => void): (() => void) => {
      const mql = window.matchMedia(query)
      mqlRef.current = mql
      mql.addEventListener('change', onChange)
      return () => {
        mql.removeEventListener('change', onChange)
        mqlRef.current = null
      }
    },
    [query],
  )

  const getSnapshot = useCallback(
    (): boolean => (mqlRef.current ?? window.matchMedia(query)).matches,
    [query],
  )

  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot)
}
