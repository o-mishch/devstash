'use client'

import type { CSSProperties } from 'react'
import { ItemIconWrapper } from '@/components/shared/item-icon-wrapper'
import { ItemStatusIcons } from '@/components/shared/item-status-icons'
import { ItemTags } from '@/components/shared/item-tags'
import { useItemDrawerStore } from '@/stores/item-drawer'
import { formatDate } from '@/lib/utils'
import { SYSTEM_TYPE_COLORS } from '@/lib/utils/constants'
import type { LightItem } from '@/types/item'

interface ItemRowProps {
  item: LightItem
}

export function ItemRow({ item }: ItemRowProps) {
  const { itemType } = item
  const { openDrawer } = useItemDrawerStore()
  const subtitle = item.descriptionPreview || item.contentPreview || item.url

  return (
    <button
      type="button"
      className="card-interactive app-row h-14 text-left gap-3 rounded-xl border-l-2 border-l-[var(--item-color)] px-2 ring-1 ring-border focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      style={{ '--item-color': SYSTEM_TYPE_COLORS[itemType.name] } as CSSProperties}
      onClick={() => openDrawer(item)}
    >
      <ItemIconWrapper itemType={itemType} wrapperClassName="size-7" iconClassName="size-3.5" />

      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          <p className="min-w-0 flex-1 truncate text-sm font-medium">{item.title}</p>
          <ItemStatusIcons isPinned={item.isPinned} isFavorite={item.isFavorite} className="size-3" />
        </div>
        {subtitle ? (
          <p className="truncate text-xs text-muted-foreground">{subtitle}</p>
        ) : null}
      </div>
      <div className="flex shrink-0 items-center gap-2">
        <ItemTags tags={item.tags} max={2} badgeClassName="hidden sm:inline-flex" />
        <span className="hidden text-xs text-muted-foreground sm:inline">{formatDate(item.createdAt)}</span>
      </div>
    </button>
  )
}
