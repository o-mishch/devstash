import { Pin, Star } from 'lucide-react'
import { cn } from '@/lib/utils'

interface ItemStatusIconsProps {
  isPinned: boolean
  isFavorite: boolean
  className?: string
}

export function ItemStatusIcons({ isPinned, isFavorite, className }: ItemStatusIconsProps) {
  if (!isPinned && !isFavorite) return null
  return (
    <div className="flex shrink-0 items-center gap-1">
      {isPinned && <Pin className={cn('size-3.5 fill-primary text-primary', className)} />}
      {isFavorite && <Star className={cn('size-3.5 fill-yellow-500 text-yellow-500', className)} />}
    </div>
  )
}
