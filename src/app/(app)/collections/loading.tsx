import { Skeleton } from '@/components/ui/skeleton'

const SKELETON_COUNT = 6

export default function CollectionsLoading() {
  return (
    <div className="flex flex-col gap-6 p-6">
      <div className="flex items-center justify-between">
        <div className="space-y-1.5">
          <Skeleton className="h-7 w-32" />
          <Skeleton className="h-4 w-24" />
        </div>
        <Skeleton className="h-8 w-36 rounded-md" />
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {[...Array(SKELETON_COUNT)].map((_, i) => (
          <div key={i} className="rounded-lg border border-border p-4 space-y-2">
            <Skeleton className="h-4 w-3/4" />
            <Skeleton className="h-3 w-16" />
            <Skeleton className="mt-1.5 h-3 w-full" />
            <Skeleton className="h-3 w-4/5" />
            <div className="flex gap-1.5 pt-1">
              <Skeleton className="size-3.5 rounded-sm" />
              <Skeleton className="size-3.5 rounded-sm" />
              <Skeleton className="size-3.5 rounded-sm" />
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
