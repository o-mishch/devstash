import type { ReactNode } from 'react'
import { Pin, Star } from 'lucide-react'
import { cn } from '@/lib/utils'

interface ItemStatusIconsProps {
  isPinned: boolean
  isFavorite: boolean
  className?: string
}

/** The pinned/favorite status glyphs shown inline on item rows. Renders nothing when neither is set. */
export function ItemStatusIcons({
  isPinned,
  isFavorite,
  className,
}: ItemStatusIconsProps): ReactNode {
  if (!isPinned && !isFavorite) return null
  return (
    <div className="flex shrink-0 items-center gap-1">
      {isPinned && (
        <Pin aria-hidden="true" className={cn('size-3.5 fill-primary text-primary', className)} />
      )}
      {isFavorite && (
        <Star
          aria-hidden="true"
          className={cn('size-3.5 fill-amber-400 text-amber-400', className)}
        />
      )}
    </div>
  )
}
