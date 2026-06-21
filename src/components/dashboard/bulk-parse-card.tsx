'use client'

import Link from 'next/link'
import { Layers, ArrowRight, RotateCw } from 'lucide-react'
import { NumberTicker } from '@/components/ui/number-ticker'
import { Popover, PopoverTrigger, PopoverContent } from '@/components/ui/popover'
import { Skeleton } from '@/components/ui/skeleton'
import { useActiveBrainDumpJobs } from '@/hooks/use-brain-dump'
import { formatRenewIn } from '@/lib/utils/format'
import { cn } from '@/lib/utils'

interface BulkParseTreatment {
  card: string
  bar: string
}

interface BulkParseCardProps {
  remaining: number
  limit: number
  resetAt: number
  treatment: BulkParseTreatment
}

// Full-width Brain Dump card beneath the four AI meters (no standalone dashboard card). Surfaces the
// 1/hr quota (reusing the meter NumberTicker/popover treatment), live "N in progress" (polled), and the
// New / Resume CTAs. The `aiSplitFile` quota is read separately from the 4-up grid (see /ai/usage).
export function BulkParseCard({ remaining, limit, resetAt, treatment }: BulkParseCardProps) {
  const { data } = useActiveBrainDumpJobs()
  const resumeJobs = data?.jobs ?? []
  const resumeJobId = resumeJobs[0]?.id ?? null
  const pct = limit > 0 ? Math.min(100, Math.round((remaining / limit) * 100)) : 0

  return (
    <div className={cn('flex flex-wrap items-center gap-3 rounded-lg border px-3 py-2.5', treatment.card)}>
      <Layers className="size-4 shrink-0 text-primary" />
      <div className="min-w-0">
        <p className="text-xs font-semibold text-foreground">Brain Dump</p>
        <p className="text-[11px] text-muted-foreground">Split a long file into items</p>
      </div>

      <Popover>
        <PopoverTrigger
          render={
            <button
              type="button"
              aria-label="Brain Dump quota"
              className="ml-auto flex items-center gap-2 rounded-md px-1.5 py-1 text-left cursor-help outline-none focus-visible:ring-2 focus-visible:ring-ring"
            />
          }
        >
          <span className="flex flex-col gap-1">
            <span className="flex items-baseline gap-0.5 text-xs font-semibold text-foreground">
              <NumberTicker value={remaining} className="tabular-nums text-foreground" />
              <span className="font-medium tabular-nums text-muted-foreground">/{limit} left</span>
            </span>
            <span className="block h-1 w-20 overflow-hidden rounded-full bg-foreground/10">
              <span
                className={cn('block h-full rounded-full transition-[width] duration-500 motion-reduce:transition-none', treatment.bar)}
                style={{ width: `${pct}%` }}
              />
            </span>
          </span>
        </PopoverTrigger>
        <PopoverContent side="top" className="w-auto max-w-[240px] gap-1 px-3 py-2">
          <p className="text-xs font-semibold text-popover-foreground">Brain Dump</p>
          <p className="text-xs text-muted-foreground">1 new split per hour. Resuming a job is always free.</p>
          <p className="text-[11px] text-muted-foreground/80">{formatRenewIn(resetAt)}</p>
        </PopoverContent>
      </Popover>

      <div className="flex items-center gap-2">
        {resumeJobs.length > 0 && resumeJobId && (
          <Link
            href={`/parse/${resumeJobId}`}
            className="flex items-center gap-1 rounded-md border border-border px-2 py-1 text-xs font-medium hover:bg-accent/40"
          >
            <RotateCw className="size-3.5" /> Review{resumeJobs.length > 1 ? ` (${resumeJobs.length})` : ''}
          </Link>
        )}
        <Link
          href="/parse"
          className="flex items-center gap-1 rounded-md bg-primary px-2 py-1 text-xs font-medium text-primary-foreground hover:bg-primary/90"
        >
          New split <ArrowRight className="size-3.5" />
        </Link>
      </div>
    </div>
  )
}

interface BulkParseCardSkeletonProps {
  treatment: BulkParseTreatment
}

export function BulkParseCardSkeleton({ treatment }: BulkParseCardSkeletonProps) {
  return (
    <div className={cn('flex items-center gap-3 rounded-lg border px-3 py-2.5', treatment.card)}>
      <Skeleton className="size-4 shrink-0 rounded" />
      <Skeleton className="h-3 w-32" />
      <Skeleton className="ml-auto h-6 w-24 rounded-md" />
    </div>
  )
}
