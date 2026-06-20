import type { CSSProperties } from 'react'
import { ItemTypeIcon } from '@/components/shared/item-type-icon'
import { formatDate } from '@/lib/utils'
import { SYSTEM_TYPE_COLORS } from '@/lib/utils/constants'
import type { LightItem } from '@/types/item'

interface FavoriteItemRowProps {
  item: LightItem
  onOpen: (item: LightItem) => void
}

export function FavoriteItemRow({ item, onOpen }: FavoriteItemRowProps) {
  const { itemType } = item
  const color = SYSTEM_TYPE_COLORS[itemType.name]

  // Same card family as the dashboard item rows: rounded-xl, left accent border, subtle ring,
  // bg-card, hover-lift — kept compact for the dense favorites tree.
  return (
    <button
      type="button"
      className="card-interactive app-row group gap-3 rounded-xl border-l-2 border-l-[var(--item-color)] bg-card px-3 py-2 text-left ring-1 ring-border touch:py-3"
      style={{ '--item-color': color } as CSSProperties}
      onClick={() => onOpen(item)}
    >
      <ItemTypeIcon typeName={itemType.name} className="size-3.5 shrink-0 touch:size-5" />
      <span className="min-w-0 flex-1 truncate text-sm touch:text-base">
        {item.title}
      </span>
      <span
        className="hidden shrink-0 rounded-md border px-1.5 py-0.5 text-[10px] capitalize sm:inline"
        style={{
          color,
          borderColor: `${color}40`,
          backgroundColor: `${color}10`,
        }}
      >
        {itemType.name}
      </span>
      <span className="hidden w-16 shrink-0 text-right text-xs text-muted-foreground md:inline">
        {formatDate(item.createdAt)}
      </span>
    </button>
  )
}
