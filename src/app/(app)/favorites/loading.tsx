import { Skeleton } from '@/components/ui/skeleton'

function SectionSkeleton({ rows }: { rows: number }) {
  return (
    <section>
      <div className="mb-1 flex items-center gap-2 px-3 pb-1 border-b border-border">
        <Skeleton className="h-3 w-16" />
      </div>
      <div className="flex flex-col">
        {Array.from({ length: rows }).map((_, i) => (
          <div key={i} className="flex items-center gap-3 px-3 py-1.5">
            <Skeleton className="size-3.5 shrink-0 rounded-full" />
            <Skeleton className="h-4 flex-1" />
            <Skeleton className="h-4 w-16" />
            <Skeleton className="h-4 w-12" />
          </div>
        ))}
      </div>
    </section>
  )
}

export default function FavoritesLoading() {
  return (
    <div className="flex flex-col gap-6 p-6">
      <div className="flex items-center gap-3">
        <Skeleton className="size-9 shrink-0 rounded-lg" />
        <div className="flex flex-col gap-1">
          <Skeleton className="h-7 w-28" />
          <Skeleton className="h-4 w-36" />
        </div>
      </div>
      <div className="flex flex-col gap-6">
        <SectionSkeleton rows={6} />
        <SectionSkeleton rows={3} />
      </div>
    </div>
  )
}
