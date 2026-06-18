import { Skeleton } from '@/components/ui/skeleton'
import { CardGridSkeleton } from '@/components/shared/skeletons'

export default function CollectionLoading() {
  return (
    <div className="app-page gap-6 p-6">
      {/* breadcrumb */}
      <Skeleton className="h-4 w-40" />

      {/* collection header */}
      <div className="flex items-center gap-3 border-l-2 border-l-border pl-3 sm:pl-4">
        <Skeleton className="size-10 shrink-0 rounded-lg" />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2.5">
            <Skeleton className="h-6 w-40" />
            <Skeleton className="h-3.5 w-16" />
          </div>
        </div>
        <Skeleton className="size-8 shrink-0 rounded-md" />
      </div>

      <CardGridSkeleton />
    </div>
  )
}
