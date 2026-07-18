import type { ReactElement, ReactNode } from 'react'
import { AlertTriangle } from 'lucide-react'
import { cn } from '@/lib/utils'

// The shared card-grid layout (dashboard, items, collections all use it).
const CARD_GRID = 'grid gap-3 sm:grid-cols-2 xl:grid-cols-3'

interface GridSkeletonProps {
  count?: number
  /** Tile height utility, e.g. `h-40` (items) or `h-28` (collections). */
  tileClassName: string
}

/** Pulsing placeholder grid shown while a card grid loads. */
export function GridSkeleton({ count = 6, tileClassName }: GridSkeletonProps): ReactElement {
  return (
    <div className={CARD_GRID}>
      {Array.from({ length: count }, (_, i) => (
        <div
          key={i}
          className={cn('animate-pulse rounded-xl border border-border bg-card/50', tileClassName)}
        />
      ))}
    </div>
  )
}

interface GridErrorBoxProps {
  /** The noun for what failed to load, e.g. `items` / `collections`. */
  label: string
}

/** Error box shared by every card grid's failure state. */
export function GridErrorBox({ label }: GridErrorBoxProps): ReactElement {
  return (
    <div className="flex flex-col items-center gap-2 rounded-xl border border-destructive/30 bg-destructive/5 py-12 text-center text-sm text-destructive">
      <AlertTriangle className="size-6" />
      Couldn’t load {label}. Try again in a moment.
    </div>
  )
}

interface CardGridStatesProps {
  isPending: boolean
  isError: boolean
  /** Noun for the error box, e.g. `items` / `collections`. */
  errorLabel: string
  isEmpty: boolean
  /** Rendered when the (loaded, non-error) set is empty. */
  emptyState: ReactNode
  /** Skeleton tile height utility, e.g. `h-40` / `h-28`. */
  tileClassName: string
  skeletonCount?: number
  /** The card grid itself, rendered only when there is data to show. */
  children: ReactNode
}

/**
 * The pending → error → empty → grid ladder every card grid shares, so a change to any state
 * (an error-box redesign, a retry button) lands in one place. Callers own the data source and
 * compose whatever tail they need (e.g. a "Load more" control) around this.
 */
export function CardGridStates({
  isPending,
  isError,
  errorLabel,
  isEmpty,
  emptyState,
  tileClassName,
  skeletonCount = 6,
  children,
}: CardGridStatesProps): ReactNode {
  if (isPending) {
    return <GridSkeleton count={skeletonCount} tileClassName={tileClassName} />
  }
  if (isError) {
    return <GridErrorBox label={errorLabel} />
  }
  if (isEmpty) {
    return emptyState
  }
  return <div className={CARD_GRID}>{children}</div>
}
