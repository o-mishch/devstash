import { memo, useCallback, useMemo } from 'react'
import type { ReactNode } from 'react'
import type { LightItem } from '@/client'
import { ItemIconWrapper } from '@/components/shared/item-icon-wrapper'
import { ItemStatusIcons } from '@/components/shared/item-status-icons'
import { ItemTags } from '@/components/shared/item-tags'
import { useItemDrawerStore } from '@/stores/item-drawer'
import { typeColor } from '@/lib/type-colors'
import { relativeTime } from '@/lib/date'
import { hasText } from '@/lib/utils'

interface ItemRowProps {
  item: LightItem
}

/**
 * A compact item row used inside the dashboard Pinned/Recent lists. Clicking it opens the item
 * detail drawer. Memoized + the store selector is narrowed to the stable `openDrawer` action so
 * opening one row's drawer doesn't re-render every sibling row.
 */
export const ItemRow = memo(function ItemRow({ item }: ItemRowProps): ReactNode {
  const { itemType } = item
  const openDrawer = useItemDrawerStore((state) => state.openDrawer)
  const subtitle = [item.descriptionPreview, item.contentPreview, item.url].find((v) => hasText(v))
  const rowStyle = useMemo(() => ({ '--item-color': typeColor(itemType.name) }), [itemType.name])
  const handleClick = useCallback(() => openDrawer(item), [openDrawer, item])

  return (
    <button
      type="button"
      onClick={handleClick}
      // oxlint-disable-next-line react/forbid-dom-props -- dynamic CSS custom property (item color)
      style={rowStyle}
      className="flex h-14 w-full items-center gap-3 rounded-xl border-l-2 border-l-[var(--item-color)] bg-card px-2 text-left ring-1 ring-border transition-transform hover:-translate-y-0.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      <ItemIconWrapper itemType={itemType} wrapperClassName="size-7" iconClassName="size-3.5" />

      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          <p className="min-w-0 flex-1 truncate text-sm font-medium">{item.title}</p>
          <ItemStatusIcons
            isPinned={item.isPinned}
            isFavorite={item.isFavorite}
            className="size-3"
          />
        </div>
        {hasText(subtitle) && <p className="truncate text-xs text-muted-foreground">{subtitle}</p>}
      </div>

      <div className="flex shrink-0 items-center gap-2">
        <ItemTags tags={item.tags} max={2} badgeClassName="hidden sm:inline-flex" />
        <span className="hidden text-xs text-muted-foreground sm:inline">
          {relativeTime(item.createdAt)}
        </span>
      </div>
    </button>
  )
})
