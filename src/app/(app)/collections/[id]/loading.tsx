import { Skeleton } from '@/components/ui/skeleton'
import { CardGridSkeleton } from '@/components/shared/skeletons'

export default function CollectionLoading() {
  return (
    <div className="flex flex-col gap-6 p-6">
      <div className="space-y-1.5">
        <Skeleton className="h-3 w-32" />
        <Skeleton className="h-7 w-48" />
        <Skeleton className="h-4 w-20" />
      </div>

      <CardGridSkeleton count={6} />
    </div>
  )
}
