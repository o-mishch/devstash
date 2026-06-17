'use client'

import { useState, useEffect, type CSSProperties, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { Maximize2, Minimize2 } from 'lucide-react'
import { cn } from '@/lib/utils'

// Shared className for the copy button in editor chrome headers. The `touch:size-5` cancels the
// Button variant's `touch:size-11` tap-target upsize so the chrome bar stays compact on mobile.
export const EDITOR_CHROME_COPY_BUTTON_CLASS =
  'size-5 touch:size-5 text-muted-foreground hover:text-white hover:bg-white/10'

interface EditorChromeHeaderProps {
  children: ReactNode
}

// The dark title bar atop every editor/viewer surface: macOS-style traffic-light dots on the
// left, caller-supplied controls (copy button, language pill, write/preview tabs) on the right.
function EditorChromeHeader({ children }: EditorChromeHeaderProps) {
  return (
    <div className="flex items-center justify-between px-3 py-0.5 border-b border-white/10 bg-[#2D2D2D] shrink-0">
      <div className="flex gap-1.5 items-center">
        <div className="size-2.5 rounded-full bg-[#FF5F56]" />
        <div className="size-2.5 rounded-full bg-[#FFBD2E]" />
        <div className="size-2.5 rounded-full bg-[#27C93F]" />
      </div>
      <div className="flex items-center gap-1">{children}</div>
    </div>
  )
}

interface EditorChromeShellProps {
  header: ReactNode
  children: ReactNode
  className?: string
  style?: CSSProperties
  // When set, a maximize/restore toggle is rendered in the chrome header (aligned with the copy
  // button) and the surface can expand to fill the viewport. The string is the accessible label
  // target, e.g. "code editor" → "Enter full screen code editor". Omit to disable the toggle.
  fullscreenLabel?: string
}

// The full editor/viewer surface: the rounded dark bordered shell + the traffic-light header bar
// + caller content. Callers supply the background (a `bg-*` class or a dynamic `style` for the
// markdown theme) and any sizing overrides via `className`.
//
// The optional fullscreen toggle lives here (not in an outer wrapper) so it sits inside the chrome
// header next to the copy button — the established editor pattern (VS Code / CodeSandbox) — instead
// of floating over the editor surface. When active the whole shell is portalled to document.body:
// the surrounding Dialog centers itself with a CSS transform, which would otherwise become the
// containing block for the shell's `position: fixed` and size it against the dialog, not the
// viewport. Portalling to body escapes that transform.
export function EditorChromeShell({ header, children, className, style, fullscreenLabel }: EditorChromeShellProps) {
  const [fullscreen, setFullscreen] = useState(false)

  useEffect(() => {
    if (!fullscreen) return
    // Capture-phase listener so Esc collapses the editor before a surrounding Dialog/Sheet can
    // treat it as a request to close the whole form; stopPropagation keeps it from bubbling there.
    function onKeyDown(e: KeyboardEvent) {
      if (e.key !== 'Escape') return
      e.stopPropagation()
      setFullscreen(false)
    }
    document.addEventListener('keydown', onKeyDown, true)
    return () => document.removeEventListener('keydown', onKeyDown, true)
  }, [fullscreen])

  const fullscreenToggle = fullscreenLabel ? (
    <button
      type="button"
      aria-pressed={fullscreen}
      aria-label={fullscreen ? `Exit full screen ${fullscreenLabel}` : `Enter full screen ${fullscreenLabel}`}
      onClick={() => setFullscreen((open) => !open)}
      className="inline-flex size-5 shrink-0 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-white/10 hover:text-white"
    >
      {fullscreen ? <Minimize2 className="size-3.5" /> : <Maximize2 className="size-3.5" />}
    </button>
  ) : null

  const shell = (
    <div
      className={cn(
        'flex flex-col flex-1 min-h-0 rounded-lg border text-card-foreground shadow-sm overflow-hidden ring-1 ring-white/10 ring-inset',
        className,
        // Beats any fixed-height className (e.g. h-64) so the surface fills the fullscreen overlay.
        fullscreen && 'h-full',
      )}
      style={style}
    >
      <EditorChromeHeader>
        {header}
        {fullscreenToggle}
      </EditorChromeHeader>
      {children}
    </div>
  )

  if (fullscreen) {
    return createPortal(
      <div className="fixed inset-0 z-50 flex flex-col bg-background p-3">{shell}</div>,
      document.body,
    )
  }

  return shell
}
