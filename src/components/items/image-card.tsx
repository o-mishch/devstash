'use client'

import { useState, type KeyboardEvent } from 'react'
import Image from 'next/image'
import { Card } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { CopyButton } from '@/components/shared/copy-button'
import { ItemStatusIcons } from '@/components/shared/item-status-icons'
import { useItemDrawer } from '@/context/item-drawer-context'
import { useAppUser } from '@/context/app-user-context'
import { getDownloadUrl } from '@/lib/utils/url'
import { useProDownloadSrc } from '@/hooks/use-pro-download-src'
import { PRO_ITEM_TYPE_NAMES } from '@/lib/utils/constants'
import type { LightItem } from '@/types/item'

interface ImageCardProps {
  item: LightItem
  priority?: boolean
}

export function ImageCard({ item, priority = false }: ImageCardProps) {
  const { openDrawer } = useItemDrawer()
  const { isPro } = useAppUser()
  const isRestricted = !isPro && PRO_ITEM_TYPE_NAMES.has(item.itemType.name)
  const [loadedSrc, setLoadedSrc] = useState<string | null>(null)
  const previewSrc = useProDownloadSrc(item.id, true)
  const isLoaded = previewSrc !== null && loadedSrc === previewSrc

  function handleCardKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key !== 'Enter' && event.key !== ' ') return
    event.preventDefault()
    openDrawer(item)
  }

  return (
    <Card
      role="button"
      tabIndex={0}
      className="card-interactive group/card relative h-full min-w-0 w-full overflow-visible p-0 focus-visible:ring-2 focus-visible:ring-ring"
      onClick={() => openDrawer(item)}
      onKeyDown={handleCardKeyDown}
    >
      <div className="relative aspect-video h-full w-full overflow-hidden rounded-xl bg-muted/30">
        {!isLoaded && (
          <Skeleton className="absolute inset-0 z-0 h-full w-full rounded-none" />
        )}
        {previewSrc ? (
          <Image
            src={previewSrc}
            alt={item.title}
            fill
            unoptimized
            crossOrigin="anonymous"
            priority={priority}
            loading={priority ? undefined : 'lazy'}
            onLoad={() => setLoadedSrc(previewSrc)}
            className={`object-cover transition-all duration-300 group-hover/card:scale-105 z-10 ${isLoaded ? 'opacity-100' : 'opacity-0'}`}
          />
        ) : null}
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
              title={isRestricted ? "Pro required" : "Copy download link"}
              isRestricted={isRestricted}
            />
          </div>
        </div>
      </div>
    </Card>
  )
}
