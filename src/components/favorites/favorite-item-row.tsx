'use client'

import { ItemTypeIcon } from '@/components/shared/item-type-icon'
import { useItemDrawer } from '@/context/item-drawer-context'
import { formatDate } from '@/lib/utils'
import type { LightItem } from '@/types/item'

interface FavoriteItemRowProps {
  item: LightItem
}

export function FavoriteItemRow({ item }: FavoriteItemRowProps) {
  const { openDrawer } = useItemDrawer()
  const { itemType } = item

  return (
    <button
      type="button"
      id={`favorite-item-${item.id}`}
      className="group flex w-full items-center gap-3 rounded px-3 py-1.5 text-left transition-colors hover:bg-accent"
      onClick={() => openDrawer(item)}
    >
      <ItemTypeIcon
        iconName={itemType.icon}
        color={itemType.color}
        className="size-3.5 shrink-0"
      />
      <span className="min-w-0 flex-1 truncate text-sm">
        {item.title}
      </span>
      <span className="shrink-0 rounded border border-border px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground">
        {itemType.name}
      </span>
      <span className="w-16 shrink-0 text-right font-mono text-xs text-muted-foreground">
        {formatDate(item.createdAt)}
      </span>
    </button>
  )
}
