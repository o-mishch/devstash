import { Skeleton } from '@/components/ui/skeleton'

export function ParseBoardSkeleton() {
  return (
    <div className="app-page gap-4 p-3 sm:gap-6 sm:p-6">
      {/* Back link: ArrowLeft icon + "Brain Dump" text (text-sm, leading ~1.25rem) */}
      <Skeleton className="h-5 w-28" />

      {/* Source banner + ParseProgress share one row on md+; stack on mobile.
          Source banner: card-surface bg-muted/20 border-border, p-3 sm:p-4, h-full flex-col justify-center.
          ParseProgress:  card-surface bg-card    border-border, p-4 sm:p-5, h-full flex-col justify-center. */}
      <div className="flex flex-col gap-4 md:flex-row md:items-stretch">
        {/* ParseSourceBanner — card-surface adds border-l-[3px] so we mirror it to avoid a 1→3px shift */}
        <div className="flex h-full flex-col justify-center rounded-xl border border-border border-l-[3px] bg-muted/20 p-3 sm:p-4 md:min-w-0 md:basis-[30%] md:grow md:shrink-0">
          <div className="flex items-center gap-2">
            <Skeleton className="size-4 shrink-0 rounded" />
            <Skeleton className="h-3.5 w-3/4" />
          </div>
        </div>

        {/* ParseProgress — completed state: icon-circle + label + subtitle + 3 action buttons.
            card-surface adds border-l-[3px]; no <Progress> bar (only renders when !done && !failed).
            Buttons (size="sm" h-7): Re-parse | Discard and Delete | Save all N */}
        <div className="rounded-xl border border-border border-l-[3px] bg-card p-4 sm:p-5 md:flex md:h-full md:basis-[70%] md:grow md:shrink-0 md:flex-col md:justify-center">
          <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center sm:gap-x-4 sm:gap-y-2">
            <div className="flex min-w-0 items-center gap-3 sm:flex-1">
              <Skeleton className="size-9 shrink-0 rounded-full" />
              <div className="flex flex-col gap-1">
                <Skeleton className="h-3.5 w-32" />
                <Skeleton className="h-3 w-20" />
              </div>
            </div>
            <div className="flex shrink-0 items-center gap-2">
              <Skeleton className="h-7 w-24 rounded-md" />
              <Skeleton className="h-7 w-36 rounded-md" />
              <Skeleton className="h-7 w-[5.5rem] rounded-md" />
            </div>
          </div>
        </div>
      </div>

      {/* ParseCollectionTarget → CollapsibleCard (defaultOpen=true):
          card-surface = border-l-[3px]; card-tier-1 ≈ bg-card slightly tinted → use bg-card for static skeleton.
          Trigger: rounded-xl p-3 sm:p-4, icon-span size-4 + title h3 text-sm + subtitle text-xs + chevron size-4 shrink-0.
          Body:    px-3 pb-3 sm:px-4 sm:pb-4, 2-col grid of Label (h-3.5) + Input (h-9). */}
      <div className="rounded-xl border border-border border-l-[3px] bg-card">
        <div className="flex w-full items-center gap-2 rounded-xl p-3 sm:p-4">
          <Skeleton className="size-4 shrink-0 rounded" />
          <div className="min-w-0 flex-1">
            <Skeleton className="h-3.5 w-36" />
            <Skeleton className="mt-1 h-3 w-56" />
          </div>
          <Skeleton className="ml-1 size-4 shrink-0 rounded" />
        </div>
        <div className="grid gap-3 px-3 pb-3 sm:grid-cols-2 sm:px-4 sm:pb-4">
          <div className="space-y-1">
            <Skeleton className="h-3.5 w-28" />
            <Skeleton className="h-9 w-full rounded-md" />
          </div>
          <div className="space-y-1">
            <Skeleton className="h-3.5 w-36" />
            <Skeleton className="h-9 w-full rounded-md" />
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
