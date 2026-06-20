'use client'

import { useState, type KeyboardEvent, type MouseEvent } from 'react'
import Image from 'next/image'
import { RotateCcw } from 'lucide-react'
import { showFileNotFoundToast } from '@/hooks/use-restricted-download'
import { Card } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { CopyButton } from '@/components/shared/copy-button'
import { ItemStatusIcons } from '@/components/shared/item-status-icons'
import { useItemDrawerStore } from '@/stores/item-drawer'
import { useAppUserFlagsStore } from '@/stores/app-user-flags'
import { getDownloadUrl } from '@/lib/utils/url'
import { useProDownloadSrc } from '@/hooks/use-pro-download-src'
import { clearSignedDownloadUrlCache, markPreviewFailed, getSignedDownloadUrl as fetchSignedDownloadUrl } from '@/lib/api/signed-download-cache'
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
  const cachedPreviewSrc = useProDownloadSrc(item.id, true)
  const previewSrc = freshSrc || cachedPreviewSrc
  const isLoaded = previewSrc !== null && loadedSrc === previewSrc

  function handleCardKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key !== 'Enter' && event.key !== ' ') return
    event.preventDefault()
    openDrawer(item)
  }

  function handleImageError() {
    markPreviewFailed(item.id, previewSrc ?? undefined)
    setError(true)
    setIsReloading(false)
    showFileNotFoundToast()
  }

  async function handleReload(e: MouseEvent) {
    e.stopPropagation()
    setFreshSrc(null)
    setIsReloading(true)
    setError(false)
    setLoadedSrc(null)

    clearSignedDownloadUrlCache(item.id)

    const freshUrl = await fetchSignedDownloadUrl(item.id, true)
    if (freshUrl) {
      // Keep isReloading true — the icon keeps spinning over the unchanged skeleton until the
      // <Image> actually finishes downloading (onLoad clears it). Don't stop here, or the UI would
      // flip to its loaded/idle state before the image is really ready.
      setFreshSrc(freshUrl)
    } else {
      setError(true)
      setIsReloading(false)
      showFileNotFoundToast()
    }
  }

  return (
    <Card
      role="button"
      tabIndex={0}
      className="card-interactive group/card relative h-full min-w-0 w-full overflow-visible p-0 ring-border focus-visible:ring-2 focus-visible:ring-ring"
      onClick={() => openDrawer(item)}
      onKeyDown={handleCardKeyDown}
    >
      <div className="relative aspect-video h-full w-full overflow-hidden rounded-xl bg-muted/30">
        {(!isLoaded || error) && (
          <Skeleton className="absolute inset-0 z-0 h-full w-full rounded-none" />
        )}
        {previewSrc && !error ? (
          <Image
            src={previewSrc}
            alt={item.title}
            fill
            unoptimized
            crossOrigin="anonymous"
            loading={priority ? 'eager' : 'lazy'}
            onLoad={() => {
              setLoadedSrc(previewSrc)
              setIsReloading(false)
            }}
            onError={handleImageError}
            className={`object-cover transition-all duration-300 group-hover/card:scale-105 z-10 ${isLoaded && !error ? 'opacity-100' : 'opacity-0'}`}
          />
        ) : null}
        {/* One reload affordance for both the failed and the retrying states: the same button stays
            in place over the skeleton and its icon just spins while reloading — it never disappears
            or swaps to a different element until the image has actually downloaded. */}
        {(error || isReloading) && (
          <div className="absolute inset-0 z-20 flex items-center justify-center pointer-events-none">
            <button
              onClick={handleReload}
              disabled={isReloading}
              className="pointer-events-auto flex size-10 items-center justify-center rounded-full bg-black/40 text-white backdrop-blur-sm transition-colors hover:bg-black/60 hover:text-white/80 disabled:cursor-not-allowed"
              title="Reload image"
            >
              <RotateCcw className={`h-5 w-5 ${isReloading ? 'animate-spin-left' : ''}`} />
            </button>
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
              className="size-7 shrink-0 text-white/70 opacity-0 transition-opacity hover:bg-white/20 hover:text-white group-hover/card:opacity-100 touch:opacity-100 z-30"
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
