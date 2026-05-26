import type { CSSProperties } from 'react'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent } from '@/components/ui/card'
import { ItemTypeIcon } from '@/lib/icon-utils'
import { formatDate } from '@/lib/utils'
import type { DashboardItem } from '@/lib/db/items'

interface ItemCardProps {
  item: DashboardItem
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
          <div className="type-icon-bg flex size-8 shrink-0 items-center justify-center rounded-full">
            <ItemTypeIcon iconName={itemType.icon} color={itemType.color} className="size-4" />
          </div>
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
