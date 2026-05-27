'use client'

import type { CSSProperties } from 'react'
import { ItemIconWrapper } from '@/components/shared/item-icon-wrapper'
import { ItemTags } from '@/components/shared/item-tags'
import { useItemDrawer } from '@/context/item-drawer-context'
import { formatDate } from '@/lib/utils'
import type { Item } from '@/types/item'

interface ItemRowProps {
  item: Item
}

export function ItemRow({ item }: ItemRowProps) {
  const { itemType } = item
  const { openDrawer } = useItemDrawer()

  return (
    <div
      className="type-border-l flex h-14 cursor-pointer items-center gap-3 overflow-hidden rounded-xl px-2 ring-1 ring-foreground/10 transition-colors hover:bg-accent"
      style={{ '--item-color': itemType.color } as CSSProperties}
      onClick={() => openDrawer(item.id)}
    >
      <ItemIconWrapper itemType={itemType} wrapperClassName="size-7" iconClassName="size-3.5" />

      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium">{item.title}</p>
        {item.description && (
          <p className="truncate text-xs text-muted-foreground">{item.description}</p>
        )}
      </div>
      <div className="flex shrink-0 items-center gap-2">
        <ItemTags tags={item.tags} max={2} badgeClassName="hidden sm:inline-flex" />
        <span className="text-xs text-muted-foreground">{formatDate(item.createdAt)}</span>
      </div>
    </div>
  )
}
