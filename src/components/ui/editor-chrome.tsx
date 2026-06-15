import { type CSSProperties, type ReactNode } from 'react'
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
      {children}
    </div>
  )
}

interface EditorChromeShellProps {
  header: ReactNode
  children: ReactNode
  className?: string
  style?: CSSProperties
}

// The full editor/viewer surface: the rounded dark bordered shell + the traffic-light header bar
// + caller content. Callers supply the background (a `bg-*` class or a dynamic `style` for the
// markdown theme) and any sizing overrides via `className`.
export function EditorChromeShell({ header, children, className, style }: EditorChromeShellProps) {
  return (
    <div
      className={cn(
        'flex flex-col flex-1 min-h-0 rounded-lg border text-card-foreground shadow-sm overflow-hidden ring-1 ring-white/10 ring-inset',
        className,
      )}
      style={style}
    >
      <EditorChromeHeader>{header}</EditorChromeHeader>
      {children}
    </div>
  )
}
