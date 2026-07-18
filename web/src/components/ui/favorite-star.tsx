import type { ReactNode } from 'react'
import { Star } from 'lucide-react'
import { cn } from '@/lib/utils'

interface FavoriteStarProps {
  isFavorite: boolean
}

/**
 * The favorite toggle's star glyph — amber and filled when active, outline when not.
 * Shared by the item and collection cards so the on/off display rule lives in one place.
 */
export function FavoriteStar({ isFavorite }: FavoriteStarProps): ReactNode {
  return (
    <Star
      className={cn('size-4', isFavorite && 'text-amber-400')}
      fill={isFavorite ? 'currentColor' : 'none'}
    />
  )
}
