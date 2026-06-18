import { Skeleton } from '@/components/ui/skeleton'
import { CollectionCardSkeleton } from '@/components/shared/skeletons'

export default function CollectionsLoading() {
  return (
    <div className="app-page gap-6 p-6">
      <div className="flex items-center justify-between">
        <div className="space-y-1.5">
          <Skeleton className="h-7 w-32" />
          <Skeleton className="h-4 w-24" />
        </div>
        <Skeleton className="h-8 w-24 rounded-md" />
      </div>

      <div className="grid w-full grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {Array.from({ length: 6 }, (_, i) => (
          <CollectionCardSkeleton key={i} />
        ))}
      </div>
    </div>
  )
}
