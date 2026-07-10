'use client'

import { useEffect, useRef, useState, startTransition, useCallback, memo } from 'react'
import dynamic from 'next/dynamic'
import { loader } from '@monaco-editor/react'

// Factory functions are extracted so the preloader can call the exact same import()
// expressions that dynamic() uses — Turbopack ties a chunk boundary to each unique
// import() call site, so sharing the reference guarantees the same chunk is warmed.
const loadCodeEditor = () => import('@/components/ui/code-editor').then(m => m.CodeEditor)
const loadMarkdownEditor = () => import('@/components/ui/markdown-editor').then(m => m.MarkdownEditor)
const loadMarkdownViewer = () => import('@/components/ui/markdown-viewer').then(m => m.MarkdownViewer)

export const CodeEditor = dynamic(loadCodeEditor, { ssr: false })
export const MarkdownEditor = dynamic(loadMarkdownEditor, { ssr: false })
export const MarkdownViewer = dynamic(loadMarkdownViewer)

// Minimal typing for the Prioritized Task Scheduling API (scheduler.postTask), which is
// not yet in the default TS DOM lib. Used to schedule the warm-up at explicit background
// priority where available, ahead of the requestIdleCallback / setTimeout fallbacks.
interface BackgroundScheduler {
  postTask: (
    callback: () => void,
    options?: { priority?: 'background' | 'user-visible' | 'user-blocking'; signal?: AbortSignal },
  ) => Promise<unknown>
}

const WARMUP_CODE = 'const warm = true\n'

interface HiddenMonacoWarmupProps {
  onReady: () => void
}

// Mounted offscreen and read-only so there is no interaction surface. Only CodeEditor is
// mounted here — its sole purpose is to spawn the Monaco worker, which requires a real DOM
// container. Markdown chunks are prefetched imperatively (no DOM needed). A ResizeObserver
// fires onReady the moment Monaco gives the container a real layout box so the parent can
// unmount exactly when warm rather than after a guessed delay.
function HiddenMonacoWarmup({ onReady }: HiddenMonacoWarmupProps) {
  const containerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const el = containerRef.current
    if (!el) return

    const observer = new ResizeObserver((entries) => {
      const laidOut = entries.some(e => e.contentRect.height > 0)
      if (laidOut) {
        observer.disconnect()
        onReady()
      }
    })
    observer.observe(el)
    return () => observer.disconnect()
  }, [onReady])

  return (
    <div
      ref={containerRef}
      aria-hidden
      className="pointer-events-none fixed left-[-9999px] top-0 select-none overflow-hidden opacity-0"
    >
      <div className="h-64 w-96">
        <CodeEditor value={WARMUP_CODE} language="javascript" readOnly className="h-full" />
      </div>
    </div>
  )
}

// Mounted once in the app layout. During browser idle time it:
// 1. Prefetches markdown/editor chunks directly (no DOM needed — just fires the dynamic imports).
// 2. Kicks Monaco core init, then mounts a hidden CodeEditor to spawn the Monaco worker.
// Unmounts once Monaco has laid out so nothing stays resident in the DOM.
export const EditorPreloader = memo(function EditorPreloader() {
  const [warm, setWarm] = useState(false)

  useEffect(() => {
    const startWarmup = () => {
      // Call the exact same factory functions passed to dynamic() — same import() call site
      // means Turbopack resolves the same chunk, so the module cache is populated before
      // any drawer or dialog triggers a render of these components.
      void loadMarkdownViewer()
      void loadMarkdownEditor()
      void loadCodeEditor()
      // Kick the Monaco core fetch; the hidden mount below then spawns the worker.
      loader.init().catch(() => { })
      // Mounting the hidden Monaco editor is a low-priority, interruptible render so it
      // never competes with real UI work. Unmounts via onReady once the worker has spawned.
      startTransition(() => setWarm(true))
    }

    // Schedule so warm-up never competes with initial render / hydration.
    // Prefer scheduler.postTask at 'background' priority, then requestIdleCallback, then setTimeout.
    const scheduler = (globalThis as { scheduler?: BackgroundScheduler }).scheduler
    if (scheduler && typeof scheduler.postTask === 'function') {
      const controller = new AbortController()
      scheduler.postTask(startWarmup, { priority: 'background', signal: controller.signal }).catch(() => { })
      return () => controller.abort()
    }

    if (typeof requestIdleCallback === 'function') {
      const idleId = requestIdleCallback(startWarmup, { timeout: 4000 })
      return () => cancelIdleCallback(idleId)
    }

    const startId = setTimeout(startWarmup, 1500)
    return () => clearTimeout(startId)
  }, [])

  const handleReady = useCallback(() => {
    startTransition(() => setWarm(false))
  }, [])

  if (!warm) return null
  return <HiddenMonacoWarmup onReady={handleReady} />
})
