import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { Pin } from 'lucide-react'
import { CollectionCardSkeleton } from '@/components/shared/skeletons'

export function CollectionsGridSkeleton() {
  return (
    <Card className="overflow-visible">
      <CardHeader className="flex flex-row items-center justify-between pb-3">
        <CardTitle className="text-sm font-semibold">Collections</CardTitle>
        <Skeleton className="h-4 w-12" />
      </CardHeader>
      <CardContent className="overflow-visible pt-0">
        <div className="app-grid card-grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
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
        <div key={i} className="app-row h-14 gap-3 rounded-xl border-l-2 border-l-muted/20 px-2 ring-1 ring-foreground/10">
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
    <Card>
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
    <Card>
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
    <div className="app-grid grid-cols-2 gap-2 sm:gap-3 lg:grid-cols-4">
      {[...Array(4)].map((_, i) => (
        <Card key={i} className="min-w-0">
          <CardContent className="p-3 sm:p-4">
            <div className="flex min-w-0 items-center gap-2 sm:gap-3">
              <div className="size-5 shrink-0 sm:size-7 rounded bg-foreground/5 animate-pulse" />
              <div className="min-w-0">
                <div className="h-5 w-12 bg-foreground/10 rounded animate-pulse sm:h-7" />
                <div className="mt-0.5 h-3 w-16 bg-foreground/5 rounded animate-pulse sm:mt-1 sm:w-20" />
              </div>
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  )
}
