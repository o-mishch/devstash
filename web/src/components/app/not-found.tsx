import type { ReactElement } from 'react'
import { Link } from '@tanstack/react-router'
import { cn } from '@/lib/utils'

interface RouterNotFoundProps {
  /**
   * Router-supplied and unused — declared only so this stays assignable to
   * `notFoundComponent`, whose props are otherwise entirely unrelated to ours.
   * (Not `extends NotFoundRouteProps`: its `routeId` circularly references the route tree.)
   */
  data?: unknown
  /** Override the default full-viewport height when rendered nested inside a layout. */
  className?: string
}

/**
 * Default not-found screen. Firebase rewrites every unknown path into the SPA shell,
 * so an unmatched route resolves here client-side rather than as a hard 404.
 *
 * Defaults to full-viewport for standalone (root-level) use; nested callers inside a shell
 * pass `className` to fill their container instead of overflowing it.
 */
export function RouterNotFound({ className }: RouterNotFoundProps): ReactElement {
  return (
    <div className={cn('flex min-h-dvh items-center justify-center bg-background p-6', className)}>
      <div className="text-center">
        <p className="font-mono text-5xl font-bold text-primary">404</p>
        <h1 className="mt-4 text-lg font-semibold text-foreground">Page not found</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          The page you’re looking for doesn’t exist.
        </p>
        <Link
          to="/"
          className="mt-6 inline-flex rounded-lg border border-border px-4 py-2 text-sm font-medium text-foreground transition-colors hover:bg-accent"
        >
          Back home
        </Link>
      </div>
    </div>
  )
}
