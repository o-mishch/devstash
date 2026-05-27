'use client'

import type { CSSProperties } from 'react'
import { Card, CardContent } from '@/components/ui/card'
import { ItemIconWrapper } from '@/components/shared/item-icon-wrapper'
import { ItemTags } from '@/components/shared/item-tags'
import { useItemDrawer } from '@/context/item-drawer-context'
import { formatDate } from '@/lib/utils'
import type { Item } from '@/types/item'

interface ItemCardProps {
  item: Item
}

export function ItemCard({ item }: ItemCardProps) {
  const { itemType } = item
  const { openDrawer } = useItemDrawer()

  return (
    <Card
      className="type-border-l h-20 cursor-pointer overflow-hidden transition-colors hover:bg-accent"
      style={{ '--item-color': itemType.color } as CSSProperties}
      onClick={() => openDrawer(item.id)}
    >
      <CardContent className="flex h-full items-center p-4">
        <div className="flex w-full items-center gap-3">
          <ItemIconWrapper itemType={itemType} wrapperClassName="size-8" iconClassName="size-4" />
          <div className="min-w-0 flex-1">
            <p className="truncate font-medium">{item.title}</p>
            {item.description && (
              <p className="mt-0.5 line-clamp-2 text-xs text-muted-foreground">{item.description}</p>
            )}
            <ItemTags tags={item.tags} max={3} className="mt-1.5" />
          </div>
          <span className="ml-2 shrink-0 text-xs text-muted-foreground">{formatDate(item.createdAt)}</span>
        </div>
      </CardContent>
    </Card>
  )
}
