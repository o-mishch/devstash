import type { ReactNode } from 'react'
import { cn } from '@/lib/utils'

interface ItemTagsProps {
  tags: readonly string[] | null | undefined
  /** Cap the number of tags shown (the rest are dropped). Defaults to all. */
  max?: number
  className?: string
  badgeClassName?: string
}

/**
 * Presentational tag chips. Non-interactive by design: these render inside item-row buttons,
 * where a nested interactive control (the legacy copy-on-click badge) would be invalid HTML.
 */
export function ItemTags({ tags, max, className, badgeClassName }: ItemTagsProps): ReactNode {
  if (!tags || tags.length === 0) return null
  const shown = max === undefined ? tags : tags.slice(0, max)

  return (
    <div className={cn('flex flex-wrap gap-1', className)}>
      {shown.map((tag) => (
        <span
          key={tag}
          className={cn(
            'rounded-md bg-muted px-1.5 py-0.5 font-mono text-[0.65rem] text-muted-foreground',
            badgeClassName,
          )}
        >
          #{tag}
        </span>
      ))}
    </div>
  )
}
