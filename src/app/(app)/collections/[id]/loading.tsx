import { Skeleton } from '@/components/ui/skeleton'

const SKELETON_COUNT = 6

export default function CollectionLoading() {
  return (
    <div className="flex flex-col gap-6 p-6">
      <div className="space-y-1.5">
        <Skeleton className="h-3 w-32" />
        <Skeleton className="h-7 w-48" />
        <Skeleton className="h-4 w-20" />
      </div>

      <div className="grid grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-3">
        {[...Array(SKELETON_COUNT)].map((_, i) => (
          <div key={i} className="flex h-20 items-center gap-3 rounded-lg border border-border p-4">
            <Skeleton className="size-8 shrink-0 rounded-md" />
            <div className="min-w-0 flex-1 space-y-2">
              <Skeleton className="h-4 w-3/4" />
              <Skeleton className="h-3 w-1/2" />
            </div>
            <Skeleton className="ml-2 h-3 w-12 shrink-0" />
          </div>
        ))}
      </div>
    </div>
  )
}
