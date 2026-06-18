import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { Pin } from 'lucide-react'
import { CollectionCardSkeleton } from '@/components/shared/skeletons'
import { STAT_CHIP_BASE } from './stat-chip'

export function CollectionsGridSkeleton() {
  return (
    <Card className="overflow-visible bg-[var(--muted,var(--background))] border-l-2 border-l-accent">
      <CardHeader className="flex flex-row items-center justify-between pb-3">
        <CardTitle className="text-sm font-semibold">Collections</CardTitle>
        <Skeleton className="h-4 w-12" />
      </CardHeader>
      <CardContent className="overflow-visible pt-0">
        <div className="app-grid card-grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
          {[...Array(6)].map((_, i) => (
            <CollectionCardSkeleton key={i} />
          ))}
        </div>
      </CardContent>
    </Card>
  )
}

function DashboardListSkeleton({ count = 3 }: { count?: number }) {
  return (
    <div className="flex flex-col gap-3">
      {[...Array(count)].map((_, i) => (
        <div key={i} className="app-row h-[56px] gap-3 rounded-xl border-l-2 border-l-muted/20 bg-card px-2 ring-1 ring-border">
          <Skeleton className="size-7 shrink-0 rounded-md" />
          <div className="min-w-0 flex-1 space-y-1.5">
            <Skeleton className="h-4 w-40" />
            <Skeleton className="h-3 w-64" />
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <Skeleton className="hidden h-5 w-12 rounded-full sm:block" />
            <Skeleton className="h-3 w-12" />
          </div>
        </div>
      ))}
    </div>
  )
}

export function PinnedSkeleton() {
  return (
    <Card className="bg-[var(--muted,var(--background))] border-l-2 border-l-accent">
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-1.5 text-sm font-semibold">
          <Pin className="size-3.5 text-muted-foreground" />
          Pinned
        </CardTitle>
      </CardHeader>
      <CardContent>
        <DashboardListSkeleton count={3} />
      </CardContent>
    </Card>
  )
}

export function RecentItemsSkeleton() {
  return (
    <Card className="bg-[var(--muted,var(--background))] border-l-2 border-l-accent">
      <CardHeader className="pb-3">
        <CardTitle className="text-sm font-semibold">Recent Items</CardTitle>
      </CardHeader>
      <CardContent>
        <DashboardListSkeleton count={3} />
      </CardContent>
    </Card>
  )
}

export function StatsCardsSkeleton() {
  return (
    <div className="grid grid-cols-2 items-stretch gap-2 sm:grid-cols-4 sm:gap-3">
      {[...Array(4)].map((_, i) => (
        <div key={i} className={STAT_CHIP_BASE}>
          <Skeleton className="size-9 shrink-0 rounded-lg" />
          {/* Bars kept shorter than the size-9 icon (h-4 + mt-1 + h-3 = 40px < 45px) so the icon
           * governs the chip height — exactly as the loaded StatChipBody does. flex-1 + max-w
           * so the label never overflows the half-width chip on mobile. */}
          <div className="min-w-0 flex-1">
            <Skeleton className="h-4 w-10 rounded" />
            <Skeleton className="mt-1 h-3 w-full max-w-24 rounded" />
          </div>
        </div>
      ))}
    </div>
  )
}
