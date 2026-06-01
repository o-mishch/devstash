'use client'

import { useState, useEffect } from 'react'
import { CodeEditor, MarkdownEditor, MarkdownViewer } from './dynamic-editors'

export function EditorPreloader() {
  const [shouldLoad, setShouldLoad] = useState(false)

  useEffect(() => {
    // requestIdleCallback is not provided by Next.js or React — use the browser native API
    // directly (falls back to setTimeout for Safari < 16.4).
    if ('requestIdleCallback' in globalThis) {
      requestIdleCallback(() => setShouldLoad(true))
    } else {
      setTimeout(() => setShouldLoad(true), 1000)
    }
  }, [])

  if (!shouldLoad) return null

  // Mounting the components in a visually hidden, non-interactive container forces React to fully resolve 
  // the next/dynamic boundaries and initializes the heavy editors (like Monaco) in the background.
  return (
    <div 
      style={{ position: 'absolute', opacity: 0, pointerEvents: 'none', width: '1px', height: '1px', overflow: 'hidden' }} 
      aria-hidden="true"
    >
      <CodeEditor value="" readOnly />
      <MarkdownEditor value="" onChange={() => {}} />
      <MarkdownViewer value="" />
    </div>
  )
}
