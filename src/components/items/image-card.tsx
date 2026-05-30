'use client'

import { useState, type CSSProperties } from 'react'
import Image from 'next/image'
import { Card } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { CopyButton } from '@/components/shared/copy-button'
import { useItemDrawer } from '@/context/item-drawer-context'
import { getBaseUrl } from '@/lib/utils/url'
import type { LightItem } from '@/types/item'

interface ImageCardProps {
  item: LightItem
  priority?: boolean
}

export function ImageCard({ item, priority = false }: ImageCardProps) {
  const { openDrawer } = useItemDrawer()
  const [isLoaded, setIsLoaded] = useState(false)

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
          className={`object-cover transition-all duration-300 group-hover/card:scale-105 z-10 ${isLoaded ? 'opacity-100' : 'opacity-0'
            }`}
        />
        <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/80 via-black/40 to-transparent p-3 pt-12 z-20">
          <div className="flex items-end justify-between gap-2">
            <p className="truncate text-sm font-medium text-white drop-shadow-sm" title={item.title}>
              {item.title}
            </p>
            <CopyButton
              value={`${getBaseUrl()}/api/download/${item.id}`}
              className="size-7 shrink-0 text-white/70 opacity-0 transition-opacity hover:bg-white/20 hover:text-white group-hover/card:opacity-100 z-30"
              iconClassName="size-3.5"
              stopPropagation
              title="Copy download link"
            />
          </div>
        </div>
      </div>
    </Card>
  )
}
