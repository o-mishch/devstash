import Link from 'next/link'
import { FileText, Scissors } from 'lucide-react'
import { getTypePlural } from '@/lib/utils/format'
import { SPLIT_FILE_MAX_INPUT_CHARS, BRAIN_DUMP_SOURCE_TAG, SYSTEM_TYPE_ORDER } from '@/lib/utils/constants'

interface ParseSourceBannerProps {
  sourceItemId: string | null
  sourceItemType: string | null
  sourceName: string | null
  truncated: boolean
}

// Persistence transparency (§11.2): shows where the source was saved (a deep-link into the stash item's
// drawer when it still exists), the durable `brain-dump` find-it hint, and — when the parse window was
// truncated — an explicit "full source saved, first N parsed" notice so the cut is never silent.
export function ParseSourceBanner({ sourceItemId, sourceItemType, sourceName, truncated }: ParseSourceBannerProps) {
  const label = sourceName ?? 'your source'
  // Deep-link opens the item's detail drawer on its type page (/items/<slug>?item=<id>). Only build it
  // for a known system type — `/items/[type]` 404s on anything else, so an unexpected type renders the
  // label as plain text instead of a broken link.
  const hasDeepLink = Boolean(sourceItemId && sourceItemType && SYSTEM_TYPE_ORDER.includes(sourceItemType))
  const href = hasDeepLink ? `/items/${getTypePlural(sourceItemType as string)}?item=${sourceItemId}` : null

  return (
    <div className="rounded-xl border border-border bg-muted/20 p-3 text-xs sm:p-4">
      <div className="flex items-center gap-2">
        <FileText className="size-4 shrink-0 text-muted-foreground" />
        <p className="text-muted-foreground">
          Saved as{' '}
          {href ? (
            <Link href={href} className="font-medium text-foreground underline-offset-2 hover:underline">
              {label}
            </Link>
          ) : (
            <span className="font-medium text-foreground">{label}</span>
          )}{' '}
          — find your sources anytime by the <code className="text-foreground">{BRAIN_DUMP_SOURCE_TAG}</code> tag.
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
