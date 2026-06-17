'use client'

import { useState, type MouseEvent } from 'react'
import { ExternalLink, Tag, Download, FileIcon, XCircle, RotateCcw } from 'lucide-react'
import { showFileNotFoundToast } from '@/hooks/use-restricted-download'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { ItemContentView } from '@/components/shared/item-content-view'
import { ImageLightbox } from '@/components/shared/image-lightbox'
import { ItemTags } from '@/components/shared/item-tags'
import { DrawerLayout, DrawerSection, DrawerCollectionsSection, DrawerDetailsSection, DrawerCollectionsSkeleton, DrawerDetailsSkeleton } from './drawer-shared'
import { ItemDrawerActionBar } from './item-drawer-action-bar'
import { ITEM_TYPES_WITH_CONTENT, ITEM_TYPES_WITH_URL, ITEM_TYPES_WITH_FILE, PRO_ITEM_TYPE_NAMES } from '@/lib/utils/constants'
import { formatBytes } from '@/lib/utils/format'
import { useProDownloadSrc, clearSignedDownloadUrlCache, markPreviewFailed, isPreviewFailed, getSignedDownloadUrl as fetchSignedDownloadUrl } from '@/hooks/use-pro-download-src'
import { useItemDrawerStore } from '@/stores/item-drawer'
import { useAppUserFlagsStore } from '@/stores/app-user-flags'
import { useRestrictedDownload } from '@/hooks/use-restricted-download'
import { isFullItem } from '@/types/item'
import type { LightItem, FullItem } from '@/types/item'

interface FileSectionProps {
  item: LightItem | FullItem
}

function FileSectionContent({ item }: FileSectionProps) {
  const { closeDrawer } = useItemDrawerStore()
  const { isPro } = useAppUserFlagsStore()
  const isRestricted = !isPro && PRO_ITEM_TYPE_NAMES.has(item.itemType.name)
  const [imageError, setImageError] = useState(false)
  const [isImageReloading, setIsImageReloading] = useState(false)
  const [lightboxOpen, setLightboxOpen] = useState(false)
  const [freshImageSrc, setFreshImageSrc] = useState<string | null>(null)
  const [loadedSrc, setLoadedSrc] = useState<string | null>(null)
  const cachedImagePreviewSrc = useProDownloadSrc(item.id, true)
  const previewSrc = freshImageSrc || cachedImagePreviewSrc
  const isImageLoaded = previewSrc !== null && loadedSrc === previewSrc
  const previewKnownFailed = !previewSrc && isPreviewFailed(item.id)
  const { handleDownload, showError } = useRestrictedDownload(
    item.id,
    isRestricted,
    false,
    closeDrawer
  )

  function handleImageError() {
    markPreviewFailed(item.id, previewSrc ?? undefined)
    setImageError(true)
    setIsImageReloading(false)
    showFileNotFoundToast()
  }

  async function handleImageReload(e: MouseEvent) {
    e.stopPropagation()
    setFreshImageSrc(null)
    setIsImageReloading(true)
    setImageError(false)
    setLoadedSrc(null)

    clearSignedDownloadUrlCache(item.id)

    const freshImageUrl = await fetchSignedDownloadUrl(item.id, true)
    if (freshImageUrl) {
      // Keep isImageReloading true — the skeleton + spinning icon stay over the unchanged box until
      // the <img> actually finishes downloading (onLoad clears it), so the placeholder never resizes
      // or swaps to a different element mid-reload.
      setFreshImageSrc(freshImageUrl)
    } else {
      setImageError(true)
      setIsImageReloading(false)
      showFileNotFoundToast()
    }
  }

  if (item.itemType.name === 'image') {
    return (
      <div className="flex justify-center">
        <div className="group relative w-full min-h-[160px] overflow-hidden rounded-md border border-border bg-muted/30">
          {/* Consistent placeholder: the skeleton (and the reload icon overlaid on it) keep the same
              box height whether idle-loading, failed, or reloading — only the icon's spin changes. The
              <img> stays absolute + invisible until it actually loads, so it never resizes the box
              mid-download. */}
          {(!isImageLoaded || imageError) && (
            <Skeleton className="h-64 w-full rounded-none" />
          )}
          {previewSrc && !imageError && (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={previewSrc}
              alt={item.fileName ?? item.title}
              crossOrigin="anonymous"
              onLoad={() => {
                setLoadedSrc(previewSrc)
                setIsImageReloading(false)
              }}
              onError={handleImageError}
              onClick={() => isImageLoaded && setLightboxOpen(true)}
              className={`w-full max-h-[50vh] object-contain ${isImageLoaded ? 'cursor-zoom-in' : 'absolute inset-0 opacity-0 pointer-events-none'}`}
            />
          )}
          {previewSrc && !imageError && (
            <ImageLightbox
              open={lightboxOpen}
              onOpenChange={setLightboxOpen}
              src={previewSrc}
              alt={item.fileName ?? item.title}
            />
          )}
          {(imageError || previewKnownFailed || isImageReloading) && (
            <div className="absolute inset-0 z-20 flex items-center justify-center pointer-events-none">
              <button
                onClick={handleImageReload}
                disabled={isImageReloading}
                className="pointer-events-auto flex size-10 items-center justify-center rounded-full bg-black/40 text-white backdrop-blur-sm transition-colors hover:bg-black/60 hover:text-white/80 disabled:cursor-not-allowed"
                title="Reload image"
              >
                <RotateCcw className={`h-5 w-5 ${isImageReloading ? 'animate-spin-left' : ''}`} />
              </button>
            </div>
          )}
          <button
            onClick={handleDownload}
            className="absolute right-2 top-2 rounded-md bg-background/50 p-1.5 backdrop-blur-sm transition-colors hover:bg-background/80 opacity-0 group-hover:opacity-100 focus:opacity-100 touch:opacity-100"
            title={isRestricted ? "Pro required" : "Download image"}
          >
            {showError ? <XCircle className="size-4 text-destructive" /> : <Download className="size-4 text-foreground" />}
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="flex items-center gap-3 rounded-lg border border-border bg-muted/50 px-3 py-2.5">
      <FileIcon className="size-4 shrink-0 text-muted-foreground" />
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium">{item.fileName ?? '—'}</p>
        {item.fileSize != null && (
          <p className="text-xs text-muted-foreground">{formatBytes(item.fileSize)}</p>
        )}
      </div>
      <Button type="button" variant="ghost" size="icon" className="size-7 shrink-0" onClick={handleDownload} title={isRestricted ? "Pro required" : "Download"}>
        {showError ? <XCircle className="size-3.5 text-destructive" /> : <Download className="size-3.5" />}
      </Button>
    </div>
  )
}

interface ItemDrawerViewContentProps {
  item: LightItem | FullItem
  isLight: boolean
  contentLoading?: boolean
  onClose: () => void
  onEdit: () => void
  onDeleted: () => void
}

export function ItemDrawerViewContent({ item, isLight, contentLoading = false, onClose, onEdit, onDeleted }: ItemDrawerViewContentProps) {
  const { itemType } = item
  const fullItem = isFullItem(item) ? item : null
  const description = isFullItem(item) ? item.description : item.descriptionPreview

  return (
    <DrawerLayout
      itemType={itemType}
      onClose={onClose}
      titleArea={
        <>
          <h2 className="text-base font-semibold leading-snug max-sm:text-sm">{item.title}</h2>
          <div className="mt-1.5 flex flex-wrap gap-1.5 max-sm:mt-1">
            <Badge variant="secondary" className="capitalize">{itemType.name}</Badge>
            {fullItem?.language && <Badge variant="outline">{fullItem.language}</Badge>}
          </div>
        </>
      }
      actionArea={
        <ItemDrawerActionBar
          item={item}
          isLight={isLight}
          fullItem={fullItem}
          onEdit={onEdit}
          onDeleted={onDeleted}
        />
      }
    >
      {ITEM_TYPES_WITH_CONTENT.has(itemType.name) && (
        // No "Content" section label: the editor's own chrome header already identifies the block,
        // so the redundant title is dropped to give the content more room.
        <section className="flex shrink-0 flex-col">
          {isLight || contentLoading ? (
            <Skeleton className="w-full rounded-md h-[70vh] min-h-[120px]" />
          ) : (
            // A definite 70vh window with contained overscroll and internal scrolling
            // (same for code + markdown, all viewports), so the content block is the
            // dominant area, its bottom stays on-screen, and the drawer scrolls
            // vertically to reveal the Description section just below it.
            <div className="overflow-hidden rounded-lg flex flex-col h-[70vh] min-h-[120px] [overscroll-behavior:contain]">
              <ItemContentView
                itemType={itemType.name}
                content={fullItem!.content}
                language={fullItem!.language}
              />
            </div>
          )}
        </section>
      )}

      {ITEM_TYPES_WITH_FILE.has(itemType.name) && (
        <DrawerSection label={itemType.name === 'image' ? 'Image' : 'File'}>
          <FileSectionContent item={item} />
        </DrawerSection>
      )}

      <DrawerSection label="Description">
        {description ? (
          <p className="text-sm leading-relaxed">{description}</p>
        ) : (
          <p className="text-sm text-muted-foreground">—</p>
        )}
      </DrawerSection>

      {ITEM_TYPES_WITH_URL.has(itemType.name) && (
        <DrawerSection label="URL">
          {item.url ? (
            <a href={item.url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1.5 text-sm text-primary underline-offset-4 hover:underline break-all">
              {item.url}
              <ExternalLink className="size-3 shrink-0" />
            </a>
          ) : (
            <p className="text-sm text-muted-foreground">—</p>
          )}
        </DrawerSection>
      )}

      <DrawerSection label="Tags" icon={<Tag className="size-3" />}>
        {item.tags.length > 0 ? (
          <ItemTags tags={item.tags} />
        ) : (
          <Button variant="outline" size="sm" className="h-7 text-xs border-dashed text-muted-foreground" onClick={onEdit}>
            Add tags...
          </Button>
        )}
      </DrawerSection>

      {isLight ? (
        <>
          <DrawerCollectionsSkeleton />
          <DrawerDetailsSkeleton />
        </>
      ) : fullItem && (
        <>
          <DrawerCollectionsSection item={fullItem} onEdit={onEdit} />
          <DrawerDetailsSection item={fullItem} />
        </>
      )}
    </DrawerLayout>
  )
}
