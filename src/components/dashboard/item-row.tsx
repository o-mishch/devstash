'use client'

import { memo, useCallback, useMemo, type CSSProperties } from 'react'
import { ItemIconWrapper } from '@/components/shared/item-icon-wrapper'
import { ItemStatusIcons } from '@/components/shared/item-status-icons'
import { ItemTags } from '@/components/shared/item-tags'
import { useItemDrawerStore } from '@/stores/item-drawer-store'
import { formatDate } from '@/lib/utils'
import { SYSTEM_TYPE_COLORS } from '@/lib/utils/constants'
import type { LightItem } from '@/types/item'

interface ItemRowProps {
  item: LightItem
}

// Rendered per-row inside the (unvirtualized, but up-to-12-row) Pinned/Recent dashboard lists.
// Memoized so clicking one row's drawer open doesn't cascade a re-render through every other row —
// `useItemDrawerStore` previously subscribed to the whole store (isOpen/selectedItemId/item/
// openScrollY), so opening ANY drawer re-rendered ALL rows; the selector below narrows the
// subscription to the one stable `openDrawer` action, and `memo` skips the re-render entirely when
// the row's own `item` reference hasn't changed.
export const ItemRow = memo(function ItemRow({ item }: ItemRowProps) {
  const { itemType } = item
  const openDrawer = useItemDrawerStore((state) => state.openDrawer)
  const subtitle = item.descriptionPreview || item.contentPreview || item.url
  const rowStyle = useMemo(() => ({ '--item-color': SYSTEM_TYPE_COLORS[itemType.name] } as CSSProperties), [itemType.name])
  const handleClick = useCallback(() => openDrawer(item), [openDrawer, item])

  return (
    <button
      type="button"
      className="card-interactive app-row h-[56px] text-left gap-3 rounded-xl border-l-2 border-l-[var(--item-color)] bg-card px-2 ring-1 ring-border focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      style={rowStyle}
      onClick={handleClick}
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
})
