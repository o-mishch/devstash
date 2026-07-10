'use client'

import { memo, useCallback, useMemo, type CSSProperties, type KeyboardEvent } from 'react'
import { Card, CardContent } from '@/components/ui/card'
import { CopyButton } from '@/components/shared/copy-button'
import { ItemIconWrapper } from '@/components/shared/item-icon-wrapper'
import { ItemStatusIcons } from '@/components/shared/item-status-icons'
import { useItemDrawerStore } from '@/stores/item-drawer-store'
import { useIsPro } from '@/hooks/profile/use-user-profile'
import { getBaseUrl } from '@/lib/utils/url'
import { formatDate } from '@/lib/utils'
import { ITEM_TYPES_WITH_FILE, PRO_ITEM_TYPE_NAMES, SYSTEM_TYPE_COLORS } from '@/lib/utils/constants'
import type { LightItem } from '@/types/item'

interface ItemCardProps {
  item: LightItem
}

// Rendered per-row inside the virtualized items grid (TanStackVirtualGrid re-renders visible rows
// on every scroll frame). Memoized so a row only re-renders when its own `item` reference changes —
// the narrowed `openDrawer` selector below keeps that action reference stable across unrelated
// drawer state changes (isOpen/selectedItemId/item/openScrollY), mirroring the dashboard ItemRow fix.
export const ItemCard = memo(function ItemCard({ item }: ItemCardProps) {
  const { itemType } = item
  const openDrawer = useItemDrawerStore((state) => state.openDrawer)
  const isPro = useIsPro()
  const hasFile = ITEM_TYPES_WITH_FILE.has(itemType.name)
  const isRestricted = !isPro && PRO_ITEM_TYPE_NAMES.has(itemType.name)
  const copyValue = hasFile ? `${getBaseUrl()}/api/download/${item.id}` : (item.url ?? item.title)
  const subtitle = item.descriptionPreview || item.contentPreview || item.url
  const cardStyle = useMemo(
    () => ({ '--item-color': SYSTEM_TYPE_COLORS[itemType.name] } as CSSProperties),
    [itemType.name],
  )
  const handleClick = useCallback(() => openDrawer(item), [openDrawer, item])

  const handleCardKeyDown = useCallback(
    (event: KeyboardEvent<HTMLDivElement>) => {
      if (event.key !== 'Enter' && event.key !== ' ') return
      event.preventDefault()
      openDrawer(item)
    },
    [openDrawer, item],
  )

  return (
    <Card
      // Can't be a real <button>: it wraps a nested <CopyButton>, and HTML forbids nested
      // interactive controls. Keyboard access is already handled via tabIndex + onKeyDown below.
      // oxlint-disable-next-line jsx-a11y/prefer-tag-over-role
      role="button"
      tabIndex={0}
      className="card-interactive group/card relative h-full min-h-20 min-w-0 gap-0 overflow-visible py-0 border-l-2 border-l-[var(--item-color)] ring-border focus-visible:ring-2 focus-visible:ring-ring"
      style={cardStyle}
      onClick={handleClick}
      onKeyDown={handleCardKeyDown}
    >
      <CardContent className="flex h-full items-center p-4">
        <div className="flex w-full min-w-0 items-center gap-3">
          <ItemIconWrapper itemType={itemType} wrapperClassName="size-8 shrink-0" iconClassName="size-4" />
          <div className="min-w-0 flex-1 overflow-hidden">
            <div className="flex items-center gap-1.5">
              <p className="min-w-0 flex-1 truncate font-medium">{item.title}</p>
              <ItemStatusIcons isPinned={item.isPinned} isFavorite={item.isFavorite} />
            </div>
            {subtitle ? (
              <p className="mt-0.5 line-clamp-2 text-xs text-muted-foreground">{subtitle}</p>
            ) : null}
            <p className="mt-1 text-xs text-muted-foreground">{formatDate(item.createdAt)}</p>
          </div>
        </div>
      </CardContent>
      <CopyButton
        value={copyValue}
        className="absolute bottom-1 right-1 size-6 opacity-0 transition-opacity group-hover/card:opacity-100 touch:opacity-100"
        iconClassName="size-3"
        stopPropagation
        isRestricted={isRestricted}
      />
    </Card>
  )
})
