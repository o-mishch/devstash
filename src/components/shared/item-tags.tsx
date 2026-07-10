'use client'

import { memo, useCallback, type MouseEvent } from 'react'
import { Badge } from '@/components/ui/badge'
import { cn } from '@/lib/utils'
import { useCopyToClipboard } from '@/hooks/ui/use-copy-to-clipboard'

interface ItemTagsProps {
  tags: string[]
  max?: number
  className?: string
  badgeClassName?: string
}

interface ItemTagBadgeProps {
  tag: string
  badgeClassName?: string
  onCopy: (event: MouseEvent, tag: string) => void
}

import type { HTMLProps } from '@base-ui/react/types'

const ItemTagBadge = memo(function ItemTagBadge({
  tag,
  badgeClassName,
  onCopy,
}: ItemTagBadgeProps) {
  const handleCopyClick = useCallback((event: MouseEvent) => {
    onCopy(event, tag)
  }, [tag, onCopy])

  const renderButton = useCallback((props: HTMLProps) => (
    <button {...props} type="button" aria-label={`Copy tag ${tag}`} />
  ), [tag])

  return (
    <Badge
      variant="secondary"
      render={renderButton}
      className={cn("text-xs", badgeClassName)}
      onClick={handleCopyClick}
    >
      {tag}
    </Badge>
  )
})

export const ItemTags = memo(function ItemTags({ tags, max = Infinity, className, badgeClassName }: ItemTagsProps) {
  const { copy } = useCopyToClipboard()

  const handleCopy = useCallback((event: MouseEvent, tag: string) => {
    event.stopPropagation()
    void copy(tag)
  }, [copy])

  if (!tags || tags.length === 0) return null

  return (
    <div className={cn("flex flex-wrap gap-1.5", className)}>
      {tags.slice(0, max).map((tag) => (
        <ItemTagBadge
          key={tag}
          tag={tag}
          badgeClassName={badgeClassName}
          onCopy={handleCopy}
        />
      ))}
    </div>
  )
})
