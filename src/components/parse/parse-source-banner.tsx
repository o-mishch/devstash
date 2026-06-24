'use client'

import { type ReactNode } from 'react'
import { FileText, Scissors, Loader2 } from 'lucide-react'
import { useCopyToClipboard } from '@/hooks/ui/use-copy-to-clipboard'
import { useOpenItemInDrawer, useItemDetail } from '@/hooks/items/use-item-detail'
import { SPLIT_FILE_MAX_INPUT_CHARS, BRAIN_DUMP_SOURCE_TAG } from '@/lib/utils/constants'
import { cn } from '@/lib/utils'

interface ParseSourceBannerProps {
  sourceItemId: string | null
  sourceName: string | null
  truncated: boolean
  // Optional footer rendered inside the same card below a divider — the job's collection picker lives
  // here so the "where this came from / where it's going" destination info shares one widget.
  footer?: ReactNode
  chrome?: boolean
}

// Persistence transparency (§11.2): shows where the source was saved, the durable `brain-dump` find-it
// hint, and — when the parse window was truncated — an explicit "full source saved, first N parsed"
// notice so the cut is never silent. The source name opens the item in the shared drawer in place (no
// navigation to its type page), so the user stays on the review board.
export function ParseSourceBanner({ sourceItemId, sourceName, truncated, footer, chrome = true }: ParseSourceBannerProps) {
  const { copy } = useCopyToClipboard()
  const { open: openSource, openingId } = useOpenItemInDrawer('That source is no longer available.')
  const opening = openingId !== null

  // `sourceName` is denormalized onto the job at creation, so it goes stale if the user later renames the
  // stash item. Read the item's live title from the shared /items/{id} cache (the same key the drawer
  // uses, so a rename in the drawer reflects here at once) and prefer it; fall back to the stored name
  // while loading or if the source was deleted (query errors → no data). No retry on a gone source.
  const itemQuery = useItemDetail(sourceItemId)
  const label = itemQuery.data?.title || sourceName || 'your source'

  function handleTagClick() {
    void copy(BRAIN_DUMP_SOURCE_TAG)
  }

  return (
    <div
      className={cn(
        '@container/source flex flex-col gap-3 text-xs',
        chrome &&
          'card-surface card-hover group rounded-xl border border-border bg-muted/20 p-3 @min-[32rem]/source:p-4',
      )}
    >
      <div className="flex flex-col gap-2">
        <div className="grid grid-cols-[auto_minmax(0,1fr)] gap-2 @min-[32rem]/source:items-center">
          <FileText className="card-icon mt-0.5 size-4 shrink-0 text-muted-foreground @min-[32rem]/source:mt-0" />
          <p className="min-w-0 text-muted-foreground">
            Saved as{' '}
            {sourceItemId ? (
              <button
                type="button"
                onClick={() => openSource(sourceItemId)}
                disabled={opening}
                className="inline-flex max-w-full items-center gap-1 align-bottom font-medium text-foreground underline-offset-2 hover:underline disabled:opacity-70"
              >
                {opening && <Loader2 className="size-3 animate-spin" />}
                <span className="truncate">{label}</span>
              </button>
            ) : (
              <span className="font-medium text-foreground">{label}</span>
            )}{' '}
            — find your sources anytime by the{' '}
            <button
              type="button"
              className="font-mono text-foreground hover:opacity-70"
              onClick={handleTagClick}
              aria-label={`Copy the ${BRAIN_DUMP_SOURCE_TAG} tag`}
            >
              {BRAIN_DUMP_SOURCE_TAG}
            </button>{' '}
            tag.
          </p>
        </div>
        {truncated && (
          <div className="grid grid-cols-[auto_minmax(0,1fr)] gap-2 text-muted-foreground">
            <Scissors className="mt-px size-3.5 shrink-0" />
            <p>
              Your full source is saved, but not all of it was parsed into items here (long sources are capped at the
              first {SPLIT_FILE_MAX_INPUT_CHARS.toLocaleString()} characters, and a very long response can stop early) —
              re-open the source to review everything.
            </p>
          </div>
        )}
      </div>
      {footer && <div className="border-t border-border/60 pt-3">{footer}</div>}
    </div>
  )
}
