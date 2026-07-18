import type { ReactNode } from 'react'
import { Loader2 } from 'lucide-react'

/**
 * Default route pending fallback. In SPA mode this component is ALSO prerendered as
 * the static shell (`/_shell.html`) that Firebase serves for every unknown path, so
 * it must render with zero data — just brand + spinner.
 */
export function RouterPending(): ReactNode {
  return (
    <div className="flex min-h-dvh items-center justify-center bg-background">
      <div className="flex flex-col items-center gap-4">
        <div className="flex items-center gap-2 font-mono text-sm text-muted-foreground">
          <span className="text-primary">devstash</span>
          <span className="opacity-40">/</span>
        </div>
        <Loader2 className="size-5 animate-spin text-primary" />
      </div>
    </div>
  )
}
