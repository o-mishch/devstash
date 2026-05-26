import type { CSSProperties } from 'react'
import { Badge } from '@/components/ui/badge'
import { ItemTypeIcon } from '@/lib/icon-utils'
import { formatDate } from '@/lib/utils'
import type { DashboardItem } from '@/lib/db/items'

interface ItemRowProps {
  item: DashboardItem
}

export function ItemRow({ item }: ItemRowProps) {
  const { itemType } = item

  return (
    <div
      className="type-border-l flex h-14 cursor-pointer items-center gap-3 overflow-hidden rounded-xl px-2 ring-1 ring-foreground/10 transition-colors hover:bg-accent"
      style={{ '--item-color': itemType.color } as CSSProperties}
    >
      <div className="type-icon-bg flex size-7 shrink-0 items-center justify-center rounded-full">
        <ItemTypeIcon iconName={itemType.icon} color={itemType.color} className="size-3.5" />
      </div>

      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium">{item.title}</p>
        {item.description && (
          <p className="truncate text-xs text-muted-foreground">{item.description}</p>
        )}
      </div>
      <div className="flex shrink-0 items-center gap-2">
        {item.tags.slice(0, 2).map((tag) => (
          <Badge key={tag} variant="secondary" className="hidden text-xs sm:inline-flex">
            {tag}
          </Badge>
        ))}
        <span className="text-xs text-muted-foreground">{formatDate(item.createdAt)}</span>
      </div>
    </div>
  )
}
