'use client'

import { useSyncExternalStore } from 'react'

// Returns `false` during SSR and the first client render, then `true` after mount. Use to defer
// rendering of client-only values (query-cache data set in a `useLayoutEffect`, browser-only state)
// until after hydration, so the server markup matches the first client paint and React doesn't warn.
// `useSyncExternalStore` with a no-op subscribe is the idiomatic way to read "are we client-side yet"
// without tripping the `react-hooks/set-state-in-effect` lint rule.
export function useMounted(): boolean {
  return useSyncExternalStore(
    () => () => {},
    () => true,
    () => false,
  )
}
