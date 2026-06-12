'use client'

import { useEffect } from 'react'
import { loader } from '@monaco-editor/react'

export function EditorPreloader() {
  useEffect(() => {
    // Defer Monaco initialization during browser idle time (lazyOnload pattern).
    // This prevents Monaco CDN requests from blocking page interactivity.
    // requestIdleCallback waits for the browser to have no pending work before initializing.
    const initMonaco = () => {
      try {
        loader.init()
      } catch {
        // Silently fail if preload doesn't work — Monaco will still load on first use
      }
    }

    if ('requestIdleCallback' in window) {
      // Safari 15.1+, Chrome 76+: defer to idle time with 3-second safety timeout
      requestIdleCallback(initMonaco, { timeout: 3000 })
    } else {
      // Fallback for older browsers: defer with 2-second delay
      const timeoutId = setTimeout(initMonaco, 2000)
      return () => clearTimeout(timeoutId)
    }
  }, [])

  return null
}
