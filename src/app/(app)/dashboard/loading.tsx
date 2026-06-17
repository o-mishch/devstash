import { Skeleton } from '@/components/ui/skeleton'
import {
  StatsCardsSkeleton,
  CollectionsGridSkeleton,
  PinnedSkeleton,
  RecentItemsSkeleton,
} from '@/components/dashboard/dashboard-skeletons'

export default function DashboardLoading() {
  return (
    <div className="app-page gap-4 p-3 sm:gap-6 sm:p-6">
      {/* Matches the `hidden sm:block` heading in page.tsx */}
      <div className="hidden sm:block">
        <Skeleton className="mb-1 h-7 w-24" />
        <Skeleton className="h-4 w-52" />
      </div>

      {/* Reuse the same skeletons the page uses as Suspense fallbacks so the
       * loading route can never drift from the loaded cards. */}
      <StatsCardsSkeleton />
      <CollectionsGridSkeleton />
      <PinnedSkeleton />
      <RecentItemsSkeleton />
    </div>
  )
}
