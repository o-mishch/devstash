'use client'

import type { CSSProperties } from 'react'
import { Card, CardContent } from '@/components/ui/card'
import { Pin, Star } from 'lucide-react'
import { CopyButton } from '@/components/shared/copy-button'
import { ItemIconWrapper } from '@/components/shared/item-icon-wrapper'
import { ItemTags } from '@/components/shared/item-tags'
import { useItemDrawer } from '@/context/item-drawer-context'
import { getBaseUrl } from '@/lib/utils/url'
import { formatDate } from '@/lib/utils'
import { ITEM_TYPES_WITH_FILE } from '@/lib/utils/constants'
import type { LightItem } from '@/types/item'

interface ItemCardProps {
  item: LightItem
}

export function ItemCard({ item }: ItemCardProps) {
  const { itemType } = item
  const { openDrawer } = useItemDrawer()
  const isFile = ITEM_TYPES_WITH_FILE.has(item.itemType.name)
  const copyValue = isFile ? `${getBaseUrl()}/api/download/${item.id}` : (item.url ?? item.title)

  return (
    <Card
      className="group/card relative type-border-l min-h-20 cursor-pointer overflow-hidden transition-colors hover:bg-accent"
      style={{ '--item-color': itemType.color } as CSSProperties}
      onClick={() => openDrawer(item)}
    >
      <CardContent className="flex h-full items-center p-4">
        <div className="flex w-full items-center gap-3">
          <ItemIconWrapper itemType={itemType} wrapperClassName="size-8" iconClassName="size-4" />
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <p className="truncate font-medium">{item.title}</p>
              <div className="flex shrink-0 items-center gap-1">
                {item.isPinned && <Pin className="size-3.5 fill-primary text-primary" />}
                {item.isFavorite && <Star className="size-3.5 fill-yellow-500 text-yellow-500" />}
              </div>
            </div>
            {item.descriptionPreview && (
              <p className="mt-0.5 line-clamp-2 text-xs text-muted-foreground">{item.descriptionPreview}</p>
            )}
            <ItemTags tags={item.tags} max={3} className="mt-1.5" />
          </div>
          <span className="ml-2 shrink-0 text-xs text-muted-foreground">{formatDate(item.createdAt)}</span>
        </div>
      </CardContent>
      <CopyButton
        value={copyValue}
        className="absolute bottom-1 right-1 size-6 opacity-0 transition-opacity group-hover/card:opacity-100"
        iconClassName="size-3"
        stopPropagation
      />
    </Card>
  )
}
