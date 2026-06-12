'use client'

import { useState, type KeyboardEvent, type MouseEvent } from 'react'
import Image from 'next/image'
import { toast } from 'sonner'
import { RotateCcw } from 'lucide-react'
import { Card } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { CopyButton } from '@/components/shared/copy-button'
import { ItemStatusIcons } from '@/components/shared/item-status-icons'
import { useItemDrawerStore } from '@/stores/item-drawer'
import { useAppUserFlagsStore } from '@/stores/app-user-flags'
import { getDownloadUrl } from '@/lib/utils/url'
import { useProDownloadSrc, clearSignedDownloadUrlCache, getSignedDownloadUrl as fetchSignedDownloadUrl } from '@/hooks/use-pro-download-src'
import { PRO_ITEM_TYPE_NAMES } from '@/lib/utils/constants'
import type { LightItem } from '@/types/item'

interface ImageCardProps {
  item: LightItem
  priority?: boolean
}

export function ImageCard({ item, priority = false }: ImageCardProps) {
  const { openDrawer } = useItemDrawerStore()
  const { isPro } = useAppUserFlagsStore()
  const isRestricted = !isPro && PRO_ITEM_TYPE_NAMES.has(item.itemType.name)
  const [loadedSrc, setLoadedSrc] = useState<string | null>(null)
  const [error, setError] = useState(false)
  const [isReloading, setIsReloading] = useState(false)
  const [freshSrc, setFreshSrc] = useState<string | null>(null)
  const [triedFallback, setTriedFallback] = useState(false)
  const [useFallback, setUseFallback] = useState(false)
  const cachedPreviewSrc = useProDownloadSrc(item.id, true)
  const previewSrc = freshSrc || cachedPreviewSrc
  const isLoaded = previewSrc !== null && loadedSrc === previewSrc

  function handleCardKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key !== 'Enter' && event.key !== ' ') return
    event.preventDefault()
    openDrawer(item)
  }

  async function handleImageError() {
    if (!triedFallback && !useFallback) {
      setTriedFallback(true)
      setUseFallback(true)
      setLoadedSrc(null)
      clearSignedDownloadUrlCache(item.id, false)
      const fullSrcUrl = await fetchSignedDownloadUrl(item.id, false)
      if (fullSrcUrl) {
        setFreshSrc(fullSrcUrl)
      }
      return
    }
    setError(true)
    setIsReloading(false)
    toast.error('Failed to load image', { id: 'image-load-error' })
  }

  async function handleReload(e: MouseEvent) {
    e.stopPropagation()
    setIsReloading(true)
    setUseFallback(false)
    setTriedFallback(false)

    clearSignedDownloadUrlCache(item.id, true)

    const previewUrl = await fetchSignedDownloadUrl(item.id, true)
    if (previewUrl) {
      setFreshSrc(previewUrl)
      setLoadedSrc(null)
    } else {
      setError(true)
    }
    setIsReloading(false)
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
        {(!isLoaded || error) && (
          <Skeleton className="absolute inset-0 z-0 h-full w-full rounded-none" />
        )}
        {previewSrc ? (
          <Image
            src={previewSrc}
            alt={item.title}
            fill
            unoptimized
            crossOrigin="anonymous"
            loading={priority ? 'eager' : 'lazy'}
            onLoad={() => {
              setLoadedSrc(previewSrc)
            }}
            onError={handleImageError}
            className={`object-cover transition-all duration-300 group-hover/card:scale-105 z-10 ${isLoaded && !error ? 'opacity-100' : 'opacity-0'}`}
          />
        ) : null}
        {error && (
          <button
            onClick={handleReload}
            disabled={isReloading}
            className="absolute inset-0 z-20 flex items-center justify-center text-white hover:text-white/80 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            title="Reload image"
          >
            <RotateCcw className={`h-6 w-6 ${isReloading ? 'animate-spin-left' : ''}`} />
          </button>
        )}
        {isReloading && (
          <div className="absolute inset-0 z-20 flex items-center justify-center">
            <RotateCcw className="h-6 w-6 text-white animate-spin-left" />
          </div>
        )}
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
