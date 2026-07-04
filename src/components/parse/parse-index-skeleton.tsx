import { Skeleton } from '@/components/ui/skeleton'

export function ParseIndexSkeleton() {
  return (
    <div className="app-page gap-4 p-3 sm:gap-6 sm:p-6">
      <div className="mx-auto flex w-full max-w-2xl flex-col gap-5">
        {/* BrainDumpCard: p-4 sm:p-5, icon+title header, tabs bar, rows=8 textarea, action row, info note */}
        <div className="rounded-xl border border-border/70 bg-muted/20 p-4 sm:p-5">
          {/* Header: size-8 icon circle + title + subtitle */}
          <div className="flex items-center gap-2">
            <Skeleton className="size-8 shrink-0 rounded-full" />
            <div className="flex flex-col gap-1.5">
              <Skeleton className="h-3.5 w-24" />
              <Skeleton className="h-3 w-64" />
            </div>
          </div>
          {/* Tabs bar: h-9 TabsList with 4 triggers */}
          <div className="mt-4">
            <Skeleton className="h-9 w-72 rounded-md" />
          </div>
          {/* Textarea: rows=8, font-mono text-xs ≈ 176px */}
          <Skeleton className="mt-3 h-44 w-full rounded-md" />
          {/* Action row: char counter left, button right */}
          <div className="mt-2 flex items-center justify-between">
            <Skeleton className="h-3 w-28" />
            <Skeleton className="h-8 w-32 rounded-md" />
          </div>
          {/* Info note: Info icon + two lines of text */}
          <div className="mt-3 flex items-start gap-1.5">
            <Skeleton className="mt-0.5 size-3.5 shrink-0 rounded" />
            <div className="flex flex-col gap-1">
              <Skeleton className="h-2.5 w-full" />
              <Skeleton className="h-2.5 w-2/3" />
            </div>
          </div>
        </div>

        {/* "In progress" section: collapsible trigger text + 1 job row */}
        <div className="flex flex-col gap-2">
          <Skeleton className="h-4 w-24" />
          <div className="flex items-center gap-3 rounded-lg border border-border/70 bg-muted/20 p-3">
            <div className="flex min-w-0 flex-1 flex-col gap-1.5">
              <div className="flex items-center gap-2">
                <Skeleton className="h-3.5 w-16" />
                <Skeleton className="h-4 w-16 rounded-full" />
              </div>
              <Skeleton className="h-3 w-40" />
              <Skeleton className="mt-0.5 h-1 w-full rounded-full" />
            </div>
            <Skeleton className="size-4 shrink-0 rounded" />
          </div>
        </div>

        {/* "History" section: collapsible trigger text + 2 history rows */}
        <div className="flex flex-col gap-2">
          <Skeleton className="h-4 w-16" />
          {Array.from({ length: 2 }).map((_, i) => (
            <div key={i} className="flex items-center gap-3 rounded-lg border border-border/70 bg-muted/20 p-3">
              <div className="flex min-w-0 flex-1 flex-col gap-1.5">
                <Skeleton className="h-3.5 w-20" />
                <Skeleton className="h-3 w-40" />
              </div>
              <Skeleton className="size-4 shrink-0 rounded" />
              <Skeleton className="size-8 shrink-0 rounded-md" />
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
