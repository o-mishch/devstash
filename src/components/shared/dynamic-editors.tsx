'use client'

import { useEffect, useRef, useState, startTransition } from 'react'
import dynamic from 'next/dynamic'
import { loader } from '@monaco-editor/react'

export const CodeEditor = dynamic(
  () => import('@/components/ui/code-editor').then(m => m.CodeEditor),
  { ssr: false }
)

export const MarkdownEditor = dynamic(
  () => import('@/components/ui/markdown-editor').then(m => m.MarkdownEditor),
  { ssr: false }
)

export const MarkdownViewer = dynamic(
  () => import('@/components/ui/markdown-viewer').then(m => m.MarkdownViewer)
)

// Minimal typing for the Prioritized Task Scheduling API (scheduler.postTask), which is
// not yet in the default TS DOM lib. Used to schedule the warm-up at explicit background
// priority where available, ahead of the requestIdleCallback / setTimeout fallbacks.
interface BackgroundScheduler {
  postTask: (
    callback: () => void,
    options?: { priority?: 'background' | 'user-visible' | 'user-blocking'; signal?: AbortSignal },
  ) => Promise<unknown>
}

// Trivial content just to drive a real mount — enough for Monaco to tokenize and for
// react-markdown to render once.
const WARMUP_CODE = 'const warm = true\n'
const WARMUP_MARKDOWN = '# warm\n\n- one'

interface HiddenEditorWarmupProps {
  onReady: () => void
}

// Mounted offscreen and read-only so there is no interaction surface. CodeEditor (read-only)
// spawns the Monaco editor worker and caches the code-editor chunk; MarkdownEditor (read-only
// → preview tab) loads the markdown-viewer chunk and exercises a react-markdown render. A
// ResizeObserver fires onReady the moment Monaco gives the container a real layout box — i.e.
// the editor has mounted and the worker has spawned — so the parent can dispose exactly when
// warm rather than after a guessed delay.
function HiddenEditorWarmup({ onReady }: HiddenEditorWarmupProps) {
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
      <div className="h-64 w-96">
        <MarkdownEditor value={WARMUP_MARKDOWN} readOnly className="h-full" />
      </div>
    </div>
  )
}

// Mounted once in the app layout. During browser idle time it warms the heavy editor stack by
// briefly mounting hidden, read-only Monaco + markdown editors — spawning the Monaco worker and
// loading every editor chunk (Monaco core, code/markdown editors, markdown viewer, react-markdown)
// into cache — then unmounts so nothing stays resident. The create-item dialog then opens with no
// chunk or worker fetch.
export function EditorPreloader() {
  const [warm, setWarm] = useState(false)

  useEffect(() => {
    const startWarmup = () => {
      // Kick the Monaco core fetch immediately; the hidden mount then spawns the worker.
      loader.init().catch(() => { })
      // Mounting the hidden editors is a low-priority, interruptible render so it never
      // competes with real UI work. The mount unmounts itself via onReady once warmed.
      startTransition(() => setWarm(true))
    }

    // Schedule the warm-up so its work never competes with initial render / hydration.
    // Prefer scheduler.postTask at explicit 'background' priority (the modern primitive),
    // then fall back to requestIdleCallback, then a plain setTimeout.
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

  if (!warm) return null
  // Unmount once the editors have laid out (worker spawned, chunks cached) — caches persist.
  return <HiddenEditorWarmup onReady={() => startTransition(() => setWarm(false))} />
}
