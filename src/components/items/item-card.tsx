import type { CSSProperties } from 'react'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent } from '@/components/ui/card'
import { ItemIconWrapper } from '@/components/shared/item-icon-wrapper'
import { formatDate } from '@/lib/utils'
import type { Item } from '@/types/item'

interface ItemCardProps {
  item: Item
}

export function ItemCard({ item }: ItemCardProps) {
  const { itemType } = item

  return (
    <Card
      className="type-border-l h-20 cursor-pointer overflow-hidden transition-colors hover:bg-accent"
      style={{ '--item-color': itemType.color } as CSSProperties}
    >
      <CardContent className="flex h-full items-center p-4">
        <div className="flex w-full items-center gap-3">
          <ItemIconWrapper itemType={itemType} wrapperClassName="size-8" iconClassName="size-4" />
          <div className="min-w-0 flex-1">
            <p className="truncate font-medium">{item.title}</p>
            {item.description && (
              <p className="mt-0.5 line-clamp-2 text-xs text-muted-foreground">{item.description}</p>
            )}
            {item.tags.length > 0 && (
              <div className="mt-1.5 flex flex-wrap gap-1.5">
                {item.tags.slice(0, 3).map((tag) => (
                  <Badge key={tag} variant="secondary" className="text-xs">
                    {tag}
                  </Badge>
                ))}
              </div>
            )}
          </div>
          <span className="ml-2 shrink-0 text-xs text-muted-foreground">{formatDate(item.createdAt)}</span>
        </div>
      </CardContent>
    </Card>
  )
}
