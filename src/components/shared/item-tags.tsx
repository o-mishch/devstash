'use client'

import type { KeyboardEvent, MouseEvent } from 'react'
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
  function handleCopy(event: MouseEvent | KeyboardEvent, tag: string) {
    event.stopPropagation()
    void copy(tag)
  }

  return (
    <div className={cn("flex flex-wrap gap-1.5", className)}>
      {tags.slice(0, max).map((tag) => (
        <Badge
          key={tag}
          variant="secondary"
          role="button"
          tabIndex={0}
          className={cn("text-xs", badgeClassName)}
          onClick={(event) => handleCopy(event, tag)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' || event.key === ' ') handleCopy(event, tag)
          }}
        >
          {tag}
        </Badge>
      ))}
    </div>
  )
}
