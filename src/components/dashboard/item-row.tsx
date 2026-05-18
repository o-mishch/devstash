import { Badge } from '@/components/ui/badge'
import { ITEM_TYPE_ICONS } from '@/lib/constants/item-types'
import type { Item, ItemType } from '@/types/item'

function formatDate(date: Date): string {
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

interface ItemRowProps {
  item: Item
  itemType: ItemType | undefined
}

export function ItemRow({ item, itemType }: ItemRowProps) {
  const Icon = itemType ? ITEM_TYPE_ICONS[itemType.icon] : null

  return (
    <div className="flex cursor-pointer items-center gap-3 rounded-md border border-border px-2 py-1.5 transition-colors hover:bg-accent/50">
      <div
        className="flex size-5 shrink-0 items-center justify-center rounded"
        style={{ backgroundColor: itemType ? `${itemType.color}20` : undefined }}
      >
        {Icon && <Icon className="size-3" style={{ color: itemType?.color }} />}
      </div>
      <p className="min-w-0 flex-1 truncate text-sm font-medium">{item.title}</p>
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
