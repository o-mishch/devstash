import { Skeleton } from '@/components/ui/skeleton'

interface PageHeaderSkeletonProps {
  actionWidthClass?: string
}

export function PageHeaderSkeleton({ actionWidthClass = 'w-36' }: PageHeaderSkeletonProps) {
  return (
    <div className="flex items-center justify-between">
      <div className="space-y-1.5">
        <Skeleton className="h-7 w-32" />
        <Skeleton className="h-4 w-24" />
      </div>
      <Skeleton className={`h-8 rounded-md ${actionWidthClass}`} />
    </div>
  )
}

interface CardGridSkeletonProps {
  count?: number
}

export function CardGridSkeleton({ count = 6 }: CardGridSkeletonProps) {
  return (
    <div className="app-grid grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-3">
      {[...Array(count)].map((_, i) => (
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
  )
}

export function CollectionCardSkeleton() {
  return (
    <div className="flex h-20 flex-col justify-center rounded-xl border border-border p-3 sm:p-4 pr-20">
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
  )
}
