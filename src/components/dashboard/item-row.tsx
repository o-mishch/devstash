import { Badge } from '@/components/ui/badge'
import { getItemIcon } from '@/lib/icon-utils'
import { formatDate } from '@/lib/utils'
import type { DashboardItem } from '@/lib/db/items'

interface ItemRowProps {
  item: DashboardItem
}

export function ItemRow({ item }: ItemRowProps) {
  const { itemType } = item
  const Icon = getItemIcon(itemType.icon)

  return (
    <div className="flex cursor-pointer items-center gap-3 rounded-md border border-border px-2 py-2 transition-colors hover:bg-accent/50">
      <div
        className="flex size-5 shrink-0 items-center justify-center rounded"
        style={{ backgroundColor: `${itemType.color}20` }}
      >
        {Icon && <Icon className="size-3" style={{ color: itemType.color }} />}
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
