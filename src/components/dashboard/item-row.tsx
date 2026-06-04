'use client'

import type { CSSProperties } from 'react'
import { ItemIconWrapper } from '@/components/shared/item-icon-wrapper'
import { ItemStatusIcons } from '@/components/shared/item-status-icons'
import { ItemTags } from '@/components/shared/item-tags'
import { useItemDrawer } from '@/context/item-drawer-context'
import { formatDate } from '@/lib/utils'
import type { LightItem } from '@/types/item'

interface ItemRowProps {
  item: LightItem
}

export function ItemRow({ item }: ItemRowProps) {
  const { itemType } = item
  const { openDrawer } = useItemDrawer()

  return (
    <button
      type="button"
      className="card-interactive flex h-14 w-full items-center text-left gap-3 overflow-hidden rounded-xl border-l-2 border-l-[var(--item-color)] px-2 ring-1 ring-foreground/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      style={{ '--item-color': itemType.color } as CSSProperties}
      onClick={() => openDrawer(item)}
    >
      <ItemIconWrapper itemType={itemType} wrapperClassName="size-7" iconClassName="size-3.5" />

      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          <p className="truncate text-sm font-medium">{item.title}</p>
          <ItemStatusIcons isPinned={item.isPinned} isFavorite={item.isFavorite} className="size-3" />
        </div>
        {item.descriptionPreview && (
          <p className="truncate text-xs text-muted-foreground">{item.descriptionPreview}</p>
        )}
      </div>
      <div className="flex shrink-0 items-center gap-2">
        <ItemTags tags={item.tags} max={2} badgeClassName="hidden sm:inline-flex" />
        <span className="text-xs text-muted-foreground">{formatDate(item.createdAt)}</span>
      </div>
    </button>
  )
}
