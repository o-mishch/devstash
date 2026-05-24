import { Skeleton } from '@/components/ui/skeleton'
import { Separator } from '@/components/ui/separator'

export function SidebarSkeleton() {
  return (
    <aside className="hidden w-56 flex-col border-r border-border bg-muted/30 lg:flex">
      <div className="flex h-14 shrink-0 items-center px-3">
        <Skeleton className="size-8 rounded-md" />
      </div>
      <Separator />
      <div className="flex-1 space-y-4 p-4">
        <div className="space-y-1.5">
          <Skeleton className="h-3 w-12" />
          {Array.from({ length: 7 }).map((_, i) => (
            <Skeleton key={i} className="h-8 w-full rounded-lg" />
          ))}
        </div>
        <Separator />
        <div className="space-y-1.5">
          <Skeleton className="h-3 w-20" />
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-8 w-full rounded-lg" />
          ))}
        </div>
      </div>
      <Separator />
      <div className="p-3">
        <Skeleton className="h-10 w-full rounded-lg" />
      </div>
    </aside>
  )
}
