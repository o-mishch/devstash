'use client'

import type { CSSProperties, MouseEvent } from 'react'
import { Copy, Check } from 'lucide-react'
import { useCopyToClipboard } from '@/hooks/use-copy-to-clipboard'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { ItemIconWrapper } from '@/components/shared/item-icon-wrapper'
import { ItemTags } from '@/components/shared/item-tags'
import { useItemDrawer } from '@/context/item-drawer-context'
import { getBaseUrl } from '@/lib/utils/url'
import { formatDate } from '@/lib/utils'
import { ITEM_TYPES_WITH_FILE } from '@/lib/utils/constants'
import type { Item } from '@/types/item'

interface ItemCardProps {
  item: Item
}

export function ItemCard({ item }: ItemCardProps) {
  const { itemType } = item
  const { openDrawer } = useItemDrawer()
  const { isCopied, copy } = useCopyToClipboard()

  function handleCopy(e: MouseEvent) {
    e.stopPropagation()
    const isFile = ITEM_TYPES_WITH_FILE.has(item.itemType.name)
    copy(isFile ? `${getBaseUrl()}/api/download/${item.id}` : (item.content ?? item.url ?? item.title))
  }

  return (
    <Card
      className="group/card relative type-border-l h-20 cursor-pointer overflow-hidden transition-colors hover:bg-accent"
      style={{ '--item-color': itemType.color } as CSSProperties}
      onClick={() => openDrawer(item)}
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
      <Button
        size="icon"
        variant="ghost"
        className="absolute bottom-1 right-1 size-6 opacity-0 transition-opacity group-hover/card:opacity-100"
        onClick={handleCopy}
        title="Copy"
      >
        {isCopied ? <Check className="size-3 text-green-400" /> : <Copy className="size-3" />}
      </Button>
    </Card>
  )
}
