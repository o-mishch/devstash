'use client'

import type { MouseEvent } from 'react'
import { Badge } from '@/components/ui/badge'
import { cn } from '@/lib/utils'
import { useCopyToClipboard } from '@/hooks/ui/use-copy-to-clipboard'

interface ItemTagsProps {
  tags: string[]
  max?: number
  className?: string
  badgeClassName?: string
}

export function ItemTags({ tags, max = Infinity, className, badgeClassName }: ItemTagsProps) {
  const { copy } = useCopyToClipboard()

  if (!tags || tags.length === 0) return null

  // Tags can render inside a clickable row (e.g. the dashboard item row), so a copy click must not
  // bubble up and trigger the parent's open-drawer handler.
  function handleCopy(event: MouseEvent, tag: string) {
    event.stopPropagation()
    void copy(tag)
  }

  return (
    <div className={cn("flex flex-wrap gap-1.5", className)}>
      {tags.slice(0, max).map((tag) => (
        <Badge
          key={tag}
          variant="secondary"
          render={<button type="button" aria-label={`Copy tag ${tag}`} />}
          className={cn("text-xs", badgeClassName)}
          onClick={(event) => handleCopy(event, tag)}
        >
          {tag}
        </Badge>
      ))}
    </div>
  )
}
