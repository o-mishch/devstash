import { Skeleton } from '@/components/ui/skeleton'
import { PageHeaderSkeleton } from '@/components/shared/skeletons'

const SKELETON_COUNT = 6

export default function CollectionsLoading() {
  return (
    <div className="flex flex-col gap-6 p-6">
      <PageHeaderSkeleton actionWidthClass="w-36" />

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {[...Array(SKELETON_COUNT)].map((_, i) => (
          <div key={i} className="flex h-20 flex-col justify-center rounded-xl border border-border p-3 sm:p-4 pr-20">
            <div className="min-w-0 w-full">
              <Skeleton className="h-4 w-3/4" />
              <Skeleton className="mt-1.5 h-3 w-full" />
              <div className="mt-2 flex items-center gap-3">
                <Skeleton className="h-3 w-12" />
                <div className="flex gap-1.5">
                  <Skeleton className="size-3 rounded-full" />
                  <Skeleton className="size-3 rounded-full" />
                  <Skeleton className="size-3 rounded-full" />
                </div>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
