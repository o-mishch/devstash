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

  return (
    <button
      type="button"
      className="card-interactive app-row group gap-3 rounded px-3 py-1.5 text-left touch:py-3"
      onClick={() => onOpen(item)}
    >
      <ItemTypeIcon typeName={itemType.name} className="size-3.5 shrink-0 touch:size-5" />
      <span className="min-w-0 flex-1 truncate text-sm touch:text-base">
        {item.title}
      </span>
      <span
        className="hidden shrink-0 rounded border px-1.5 py-0.5 font-mono text-[10px] capitalize sm:inline"
        style={{
          color: SYSTEM_TYPE_COLORS[itemType.name],
          borderColor: `${SYSTEM_TYPE_COLORS[itemType.name]}40`,
          backgroundColor: `${SYSTEM_TYPE_COLORS[itemType.name]}10`,
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
