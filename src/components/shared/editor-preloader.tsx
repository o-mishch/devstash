'use client'

import { useState, useEffect } from 'react'
import { CodeEditor, MarkdownEditor, MarkdownViewer } from './dynamic-editors'

export function EditorPreloader() {
  const [shouldLoad, setShouldLoad] = useState(false)

  useEffect(() => {
    // Justification: We use the browser's native window.requestIdleCallback because Next.js and React 
    // do not provide a framework-level alternative to run low-priority background prefetching after paint.
    const requestIdleCallback = typeof window !== 'undefined' && window.requestIdleCallback 
      ? window.requestIdleCallback 
      : ((cb: any) => setTimeout(cb, 1000))
    
    requestIdleCallback(() => {
      setShouldLoad(true)
    })
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
