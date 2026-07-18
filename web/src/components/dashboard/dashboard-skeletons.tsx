import type { ReactNode } from 'react'
import { AlertTriangle } from 'lucide-react'
import { STAT_CHIP_BASE } from './stat-chip'
import { cn } from '@/lib/utils'

/**
 * Stat-strip loading placeholder. Reuses STAT_CHIP_BASE so the skeleton and the loaded chips share
 * the exact sizing (including the 2px left-border gutter) — no 1px shift when data arrives.
 */
export function StatsCardsSkeleton(): ReactNode {
  return (
    <div className="grid grid-cols-2 items-stretch gap-2 sm:grid-cols-4 sm:gap-3">
      {Array.from({ length: 4 }, (_, i) => (
        <div key={i} className={cn(STAT_CHIP_BASE, 'animate-pulse')}>
          <span className="size-8 shrink-0 rounded-lg bg-muted" />
          <div className="flex min-w-0 flex-1 flex-col gap-1.5">
            <span className="h-3 w-8 rounded bg-muted" />
            <span className="h-2.5 w-16 rounded bg-muted" />
          </div>
        </div>
      ))}
    </div>
  )
}

/** Whole-dashboard loading placeholder shown by the route while stats + recent load. */
export function DashboardSkeleton(): ReactNode {
  return (
    <div className="flex flex-col gap-6">
      <div className="hidden flex-col gap-1.5 sm:flex">
        <span className="h-6 w-40 animate-pulse rounded bg-muted" />
        <span className="h-4 w-56 animate-pulse rounded bg-muted" />
      </div>
      <StatsCardsSkeleton />
      {Array.from({ length: 3 }, (_, i) => (
        <div key={i} className="h-40 animate-pulse rounded-xl border border-border bg-card/50" />
      ))}
    </div>
  )
}

/** Whole-dashboard error state shown by the route when stats/recent fail to load. */
export function DashboardError(): ReactNode {
  return (
    <div className="flex flex-col items-center gap-2 rounded-xl border border-destructive/30 bg-destructive/5 py-12 text-center text-sm text-destructive">
      <AlertTriangle className="size-6" />
      Couldn’t load your dashboard. Try again in a moment.
    </div>
  )
}
