import type { ReactNode } from 'react'
import { useRouter } from '@tanstack/react-router'
import type { ErrorComponentProps } from '@tanstack/react-router'
import { RotateCw } from 'lucide-react'
import { toast } from 'sonner'
import { cn } from '@/lib/utils'

interface RouterCatchBoundaryProps extends ErrorComponentProps {
  /** Override the default full-viewport height when rendered nested inside a layout. */
  className?: string
}

/**
 * Default error boundary for any route whose loader/component throws. A thrown
 * session query (network / 5xx) lands here — NOT a logout — so a transient blip is
 * recoverable via the retry button rather than bouncing the user to sign-in.
 *
 * Defaults to full-viewport for standalone (root-level) use; nested callers inside a shell
 * pass `className` to fill their container instead of overflowing it.
 */
const FALLBACK_MESSAGE = 'Something went wrong'

// Only ever render our own thrown messages verbatim — an Error surfacing here can
// originate from a fetch/network failure whose `.message` may embed a URL or other
// internal detail we don't want rendered to the user.
const SAFE_MESSAGES = new Set([
  'Failed to fetch',
  'Load failed',
  'NetworkError when attempting to fetch resource.',
])

// Router invalidation can reject (e.g. a loader re-throwing the same network error); logged and
// surfaced to the user here rather than left as an unhandled rejection, since the click handler
// can't await it.
async function retryNavigation(router: ReturnType<typeof useRouter>): Promise<void> {
  try {
    await router.invalidate()
  } catch (err) {
    console.error('Failed to retry after route error:', err)
    toast.error('Failed to retry. Please refresh the page.')
  }
}

export function RouterCatchBoundary({ error, className }: RouterCatchBoundaryProps): ReactNode {
  const router = useRouter()
  const message =
    error instanceof Error && SAFE_MESSAGES.has(error.message) ? error.message : FALLBACK_MESSAGE

  return (
    <div className={cn('flex min-h-dvh items-center justify-center bg-background p-6', className)}>
      <div className="w-full max-w-md rounded-xl border border-border bg-card p-6 text-center">
        <p className="font-mono text-xs uppercase tracking-widest text-destructive">error</p>
        <h1 className="mt-3 text-lg font-semibold text-card-foreground">
          This view failed to load
        </h1>
        <p className="mt-2 break-words font-mono text-sm text-muted-foreground">{message}</p>
        <button
          type="button"
          onClick={() => {
            void retryNavigation(router)
          }}
          className="mt-6 inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-opacity hover:opacity-90"
        >
          <RotateCw className="size-4" />
          Retry
        </button>
      </div>
    </div>
  )
}
