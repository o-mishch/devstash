'use client'

import { useState, type CSSProperties } from 'react'
import Image from 'next/image'
import { Card } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { CopyButton } from '@/components/shared/copy-button'
import { ItemStatusIcons } from '@/components/shared/item-status-icons'
import { useItemDrawer } from '@/context/item-drawer-context'
import { getDownloadUrl } from '@/lib/utils/url'
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
      className="card-interactive group/card relative overflow-hidden p-0"
      style={{ '--item-color': item.itemType.color } as CSSProperties}
      onClick={() => openDrawer(item)}
    >
      <div className="relative aspect-video w-full overflow-hidden bg-muted/30">
        {!isLoaded && (
          <Skeleton className="absolute inset-0 z-0 h-full w-full rounded-none" />
        )}
        <Image
          src={getDownloadUrl(item.id)}
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
            <div className="flex items-center gap-1.5 min-w-0">
              <ItemStatusIcons isPinned={item.isPinned} isFavorite={item.isFavorite} />
              <p className="truncate text-sm font-medium text-white drop-shadow-sm" title={item.title}>
                {item.title}
              </p>
            </div>
            <CopyButton
              value={getDownloadUrl(item.id, true)}
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
