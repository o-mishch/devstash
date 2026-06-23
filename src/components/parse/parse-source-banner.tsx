'use client'

import { FileText, Scissors, Loader2 } from 'lucide-react'
import { useCopyToClipboard } from '@/hooks/use-copy-to-clipboard'
import { useOpenItemInDrawer } from '@/hooks/use-item-detail'
import { $api } from '@/lib/api/client'
import { SPLIT_FILE_MAX_INPUT_CHARS, BRAIN_DUMP_SOURCE_TAG } from '@/lib/utils/constants'

interface ParseSourceBannerProps {
  sourceItemId: string | null
  sourceName: string | null
  truncated: boolean
}

// Persistence transparency (§11.2): shows where the source was saved, the durable `brain-dump` find-it
// hint, and — when the parse window was truncated — an explicit "full source saved, first N parsed"
// notice so the cut is never silent. The source name opens the item in the shared drawer in place (no
// navigation to its type page), so the user stays on the review board.
export function ParseSourceBanner({ sourceItemId, sourceName, truncated }: ParseSourceBannerProps) {
  const { copy } = useCopyToClipboard()
  const { open: openSource, openingId } = useOpenItemInDrawer('That source is no longer available.')
  const opening = openingId !== null

  // `sourceName` is denormalized onto the job at creation, so it goes stale if the user later renames the
  // stash item. Read the item's live title from the shared /items/{id} cache (the same key the drawer
  // uses, so a rename in the drawer reflects here at once) and prefer it; fall back to the stored name
  // while loading or if the source was deleted (query errors → no data). No retry on a gone source.
  const itemQuery = $api.useQuery(
    'get',
    '/items/{id}',
    { params: { path: { id: sourceItemId ?? '' } } },
    { enabled: Boolean(sourceItemId), retry: false },
  )
  const label = itemQuery.data?.title || sourceName || 'your source'

  function handleTagClick() {
    void copy(BRAIN_DUMP_SOURCE_TAG)
  }

  return (
    <div className="card-surface card-hover group flex h-full flex-col justify-center rounded-xl border border-border bg-muted/20 p-3 text-xs sm:p-4">
      <div className="flex items-center gap-2">
        <FileText className="card-icon size-4 shrink-0 text-muted-foreground" />
        <p className="text-muted-foreground">
          Saved as{' '}
          {sourceItemId ? (
            <button
              type="button"
              onClick={() => openSource(sourceItemId)}
              disabled={opening}
              className="inline-flex items-center gap-1 font-medium text-foreground underline-offset-2 hover:underline disabled:opacity-70"
            >
              {opening && <Loader2 className="size-3 animate-spin" />}
              {label}
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
        <div className="mt-2 flex items-start gap-2 text-muted-foreground">
          <Scissors className="mt-px size-3.5 shrink-0" />
          <p>
            Your full source is saved, but not all of it was parsed into items here (long sources are capped at the
            first {SPLIT_FILE_MAX_INPUT_CHARS.toLocaleString()} characters, and a very long response can stop early) —
            re-open the source to review everything.
          </p>
        </div>
      )}
    </div>
  )
}
