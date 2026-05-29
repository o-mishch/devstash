'use client'

import { useState, type CSSProperties, type MouseEvent } from 'react'
import Image from 'next/image'
import { Copy, Check } from 'lucide-react'
import { useCopyToClipboard } from '@/hooks/use-copy-to-clipboard'
import { Card } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { Button } from '@/components/ui/button'
import { useItemDrawer } from '@/context/item-drawer-context'
import { getBaseUrl } from '@/lib/utils/url'
import type { Item } from '@/types/item'

interface ImageCardProps {
  item: Item
  priority?: boolean
}

export function ImageCard({ item, priority = false }: ImageCardProps) {
  const { openDrawer } = useItemDrawer()
  const [isLoaded, setIsLoaded] = useState(false)
  const { isCopied, copy } = useCopyToClipboard()

  function handleCopy(e: MouseEvent) {
    e.stopPropagation()
    copy(`${getBaseUrl()}/api/download/${item.id}`)
  }

  return (
    <Card
      className="group/card relative cursor-pointer overflow-hidden transition-colors hover:bg-accent"
      style={{ '--item-color': item.itemType.color } as CSSProperties}
      onClick={() => openDrawer(item)}
    >
      <div className="relative aspect-video w-full overflow-hidden bg-muted/30">
        {!isLoaded && (
          <Skeleton className="absolute inset-0 z-0 h-full w-full rounded-none" />
        )}
        <Image
          src={`/api/download/${item.id}`}
          alt={item.title}
          fill
          unoptimized
          priority={priority}
          onLoad={() => setIsLoaded(true)}
          className={`object-cover transition-all duration-300 group-hover/card:scale-105 z-10 ${
            isLoaded ? 'opacity-100' : 'opacity-0'
          }`}
        />
        <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/80 via-black/40 to-transparent p-3 pt-12">
          <div className="flex items-end justify-between">
            <p className="truncate text-sm font-medium text-white">{item.title}</p>
            <Button
              size="icon"
              variant="ghost"
              className="size-7 shrink-0 text-white/70 opacity-0 transition-opacity hover:bg-white/20 hover:text-white group-hover/card:opacity-100"
              onClick={handleCopy}
              title="Copy link"
            >
              {isCopied ? <Check className="size-3.5 text-green-400" /> : <Copy className="size-3.5" />}
            </Button>
          </div>
        </div>
      </div>
    </Card>
  )
}
