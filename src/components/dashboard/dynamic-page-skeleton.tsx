import { Skeleton } from '@/components/ui/skeleton'
import { StatsCardsSkeleton, CollectionsGridSkeleton, PinnedSkeleton, RecentItemsSkeleton } from './dashboard-skeletons'

export function DynamicPageSkeleton() {
  return (
    <div className="app-page gap-4 p-3 sm:gap-6 sm:p-6 animate-pulse">
      {/* Matches the `hidden sm:block` heading in page.tsx */}
      <div className="hidden sm:block">
        <Skeleton className="mb-1 h-7 w-24" />
        <Skeleton className="h-4 w-52" />
      </div>

      <StatsCardsSkeleton />
      <CollectionsGridSkeleton />
      <PinnedSkeleton />
      <RecentItemsSkeleton />
    </div>
  )
}
