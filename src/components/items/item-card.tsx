'use client'

import type { CSSProperties } from 'react'
import { Card, CardContent } from '@/components/ui/card'
import { CopyButton } from '@/components/shared/copy-button'
import { ItemIconWrapper } from '@/components/shared/item-icon-wrapper'
import { ItemStatusIcons } from '@/components/shared/item-status-icons'
import { useItemDrawer } from '@/context/item-drawer-context'
import { useAppUser } from '@/context/app-user-context'
import { getBaseUrl } from '@/lib/utils/url'
import { formatDate } from '@/lib/utils'
import { ITEM_TYPES_WITH_FILE, PRO_ITEM_TYPE_NAMES } from '@/lib/utils/constants'
import type { LightItem } from '@/types/item'

interface ItemCardProps {
  item: LightItem
}

export function ItemCard({ item }: ItemCardProps) {
  const { itemType } = item
  const { openDrawer } = useItemDrawer()
  const { isPro } = useAppUser()
  const hasFile = ITEM_TYPES_WITH_FILE.has(itemType.name)
  const isRestricted = !isPro && PRO_ITEM_TYPE_NAMES.has(itemType.name)
  const copyValue = hasFile ? `${getBaseUrl()}/api/download/${item.id}` : (item.url ?? item.title)
  const subtitle = item.descriptionPreview || item.contentPreview || item.url

  return (
    <Card
      className="card-interactive group/card relative h-full min-h-20 min-w-0 gap-0 py-0 border-l-2 border-l-[var(--item-color)]"
      style={{ '--item-color': itemType.color } as CSSProperties}
    >
      <button
        type="button"
        className="h-full w-full min-w-0 text-left outline-none focus-visible:bg-foreground/5 focus-visible:ring-2 focus-visible:ring-ring"
        onClick={() => openDrawer(item)}
      >
        <CardContent className="flex h-full items-center p-4">
          <div className="flex w-full min-w-0 items-center gap-3">
            <ItemIconWrapper itemType={itemType} wrapperClassName="size-8" iconClassName="size-4" />
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <p className="truncate font-medium">{item.title}</p>
                <ItemStatusIcons isPinned={item.isPinned} isFavorite={item.isFavorite} />
              </div>
              {subtitle ? (
                <p className="mt-0.5 line-clamp-2 text-xs text-muted-foreground">{subtitle}</p>
              ) : null}
            </div>
            <span className="ml-2 hidden shrink-0 text-xs text-muted-foreground sm:inline">{formatDate(item.createdAt)}</span>
          </div>
        </CardContent>
      </button>
      <CopyButton
        value={copyValue}
        className="absolute bottom-1 right-1 size-6 opacity-0 transition-opacity group-hover/card:opacity-100"
        iconClassName="size-3"
        stopPropagation
        isRestricted={isRestricted}
      />
    </Card>
  )
}
