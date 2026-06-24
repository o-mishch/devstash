import { Skeleton } from '@/components/ui/skeleton'

export function ParseBoardSkeleton() {
  return (
    <div className="app-page gap-4 p-3 sm:gap-6 sm:p-6">
      {/* Back link: ArrowLeft icon + "Brain Dump" text (text-sm, leading ~1.25rem) */}
      <Skeleton className="h-5 w-28" />

      {/* Single merged workflow header: source/destination on the left, status/actions on the right when
          the container is wide enough. */}
      <div className="rounded-xl border border-border border-l-[3px] bg-muted/20 p-3 sm:p-4">
        <div className="@container/parse-top">
          <div className="grid gap-4 @min-[54rem]/parse-top:grid-cols-[minmax(0,1.05fr)_minmax(23rem,0.95fr)] @min-[54rem]/parse-top:items-stretch">
            <div className="flex min-w-0 flex-col gap-3">
              <div className="flex items-center gap-2">
                <Skeleton className="size-4 shrink-0 rounded" />
                <Skeleton className="h-3.5 w-3/4" />
              </div>
              <div className="space-y-1.5 border-t border-border/60 pt-3">
                <Skeleton className="h-3 w-32" />
                <Skeleton className="h-9 w-full rounded-md" />
              </div>
            </div>

            <div className="flex min-w-0 flex-col justify-center border-t border-border/60 pt-4 @min-[54rem]/parse-top:border-l @min-[54rem]/parse-top:border-t-0 @min-[54rem]/parse-top:pt-0 @min-[54rem]/parse-top:pl-4">
              <div className="grid gap-3 @min-[48rem]/parse-top:grid-cols-[minmax(12rem,1fr)_auto] @min-[48rem]/parse-top:items-center @min-[48rem]/parse-top:gap-4">
                <div className="flex min-w-0 items-center gap-3">
                  <Skeleton className="size-9 shrink-0 rounded-full" />
                  <div className="flex flex-col gap-1">
                    <Skeleton className="h-3.5 w-32" />
                    <Skeleton className="h-3 w-20" />
                  </div>
                </div>
                <div className="flex flex-wrap items-center gap-2 @min-[48rem]/parse-top:flex-nowrap">
                  <Skeleton className="h-7 w-24 rounded-md" />
                  <Skeleton className="h-7 w-36 rounded-md" />
                  <Skeleton className="h-7 w-[5.5rem] rounded-md" />
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* BucketColumn grid — 6 columns (snippet/command/prompt/note/link/trash).
          Each column: rounded-xl border border-border/70 bg-muted/20 p-2.5.
          Header: flex items-center gap-2 px-1 pb-1.
            CollapsibleTrigger (flex-1): icon size-4 + label text-sm font-semibold + chevron size-3.5 + count badge ml-auto.
            "Save all" button sibling: h-6 px-2 text-xs (absent on trash/empty, shown here for non-empty buckets).
          On cold load drafts are already populated (no flash), so show placeholder cards. */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {[...Array(6)].map((_, i) => (
          <div key={i} className="flex flex-col gap-2 rounded-xl border border-border/70 bg-muted/20 p-2.5">
            <div className="flex items-center gap-2 px-1 pb-1">
              {/* CollapsibleTrigger: flex-1 with icon + label + chevron + count */}
              <div className="flex min-w-0 flex-1 items-center gap-2">
                <Skeleton className="size-4 shrink-0 rounded" />
                <Skeleton className="h-3.5 w-20" />
                <Skeleton className="size-3.5 shrink-0 rounded" />
                <Skeleton className="ml-auto h-4 w-6 rounded-full" />
              </div>
              {/* "Save all" button — present on non-trash non-empty buckets */}
              {i < 5 && <Skeleton className="h-6 w-14 shrink-0 rounded-md" />}
            </div>
            {/* Draft card placeholders: matches ParseDraftCard — rounded-lg border border-border bg-card px-2.5 py-2,
                app-row = flex gap-2.5, icon size-4 + title text-sm font-medium + subtitle text-xs */}
            <div className="flex flex-col gap-2">
              <div className="flex items-start gap-2.5 rounded-lg border border-border bg-card px-2.5 py-2">
                <Skeleton className="mt-px size-4 shrink-0 rounded" />
                <div className="min-w-0 flex-1">
                  <Skeleton className="h-3.5 w-3/5" />
                  <Skeleton className="mt-1 h-3 w-full" />
                </div>
              </div>
              {i < 4 && (
                <div className="flex items-start gap-2.5 rounded-lg border border-border bg-card px-2.5 py-2">
                  <Skeleton className="mt-px size-4 shrink-0 rounded" />
                  <div className="min-w-0 flex-1">
                    <Skeleton className="h-3.5 w-2/5" />
                  </div>
                </div>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
