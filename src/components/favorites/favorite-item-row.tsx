import { ItemTypeIcon } from '@/components/shared/item-type-icon'
import { formatDate } from '@/lib/utils'
import type { LightItem } from '@/types/item'

interface FavoriteItemRowProps {
  item: LightItem
  onOpen: (item: LightItem) => void
}

export function FavoriteItemRow({ item, onOpen }: FavoriteItemRowProps) {
  const { itemType } = item

  return (
    <button
      type="button"
      className="card-interactive app-row group gap-3 rounded px-3 py-1.5 text-left"
      onClick={() => onOpen(item)}
    >
      <ItemTypeIcon
        iconName={itemType.icon}
        color={itemType.color}
        className="size-3.5 shrink-0"
      />
      <span className="min-w-0 flex-1 truncate text-sm">
        {item.title}
      </span>
      <span
        className="hidden shrink-0 rounded border px-1.5 py-0.5 font-mono text-[10px] capitalize sm:inline"
        style={{
          color: itemType.color,
          borderColor: `${itemType.color}40`,
          backgroundColor: `${itemType.color}10`,
        }}
      >
        {itemType.name}
      </span>
      <span className="hidden w-16 shrink-0 text-right font-mono text-xs text-muted-foreground md:inline">
        {formatDate(item.createdAt)}
      </span>
    </button>
  )
}
