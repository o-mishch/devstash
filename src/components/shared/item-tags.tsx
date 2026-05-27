import { Badge } from '@/components/ui/badge'
import { cn } from '@/lib/utils'

interface ItemTagsProps {
  tags: string[]
  max?: number
  className?: string
  badgeClassName?: string
}

export function ItemTags({ tags, max = Infinity, className, badgeClassName }: ItemTagsProps) {
  if (!tags || tags.length === 0) return null

  return (
    <div className={cn("flex flex-wrap gap-1.5", className)}>
      {tags.slice(0, max).map((tag) => (
        <Badge key={tag} variant="secondary" className={cn("text-xs", badgeClassName)}>
          {tag}
        </Badge>
      ))}
    </div>
  )
}
