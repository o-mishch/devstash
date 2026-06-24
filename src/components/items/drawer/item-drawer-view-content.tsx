'use client'

import { useState, useCallback, type MouseEvent } from 'react'
import { ExternalLink, Tag, Download, FileIcon, XCircle, RotateCcw } from 'lucide-react'
import { useRestrictedDownload } from '@/hooks/billing/use-restricted'
import { showFileNotFoundToast } from '@/lib/dom/toast-error'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { ItemContentView } from '@/components/shared/item-content-view'
import { ConfirmDialog } from '@/components/shared/confirm-dialog'
import { ImageLightbox } from '@/components/shared/image-lightbox'
import { ItemTags } from '@/components/shared/item-tags'
import { DrawerLayout, DrawerSection, DrawerCollectionsSection, DrawerDetailsSection, DrawerCollectionsSkeleton, DrawerDetailsSkeleton } from './drawer-shared'
import { ItemDrawerActionBar } from './item-drawer-action-bar'
import { useAiItemRewrite } from '@/hooks/ai/use-ai-item-rewrite'
import { useAiMutation } from '@/hooks/ai/use-ai-usage'
import { useDirtyGuard } from '@/hooks/ui/use-dirty-guard'
import { useRegisterSheetClose, type SheetCloseRef } from '@/hooks/ui/use-register-sheet-close'
import { ITEM_TYPES_WITH_CONTENT, ITEM_TYPES_WITH_CODE_EDITOR, ITEM_TYPES_WITH_PROMPT_OPTIMIZE, ITEM_TYPES_WITH_URL, ITEM_TYPES_WITH_FILE, PRO_ITEM_TYPE_NAMES, EXPLAIN_MAX_INPUT_CHARS, OPTIMIZE_MAX_INPUT_CHARS } from '@/lib/utils/constants'
import { formatBytes } from '@/lib/utils/format'
import { useProDownloadSrc, useDownloadSrcActions, markPreviewFailed, isPreviewFailed } from '@/hooks/billing/use-pro-download-src'
import { useItemDrawerStore } from '@/stores/item-drawer-store'
import { useIsPro } from '@/hooks/profile/use-user-profile'
import { isFullItem } from '@/types/item'
import type { LightItem, FullItem } from '@/types/item'

interface FileSectionProps {
  item: LightItem | FullItem
}

function FileSectionContent({ item }: FileSectionProps) {
  const { closeDrawer } = useItemDrawerStore()
  const isPro = useIsPro()
  const { refresh } = useDownloadSrcActions()
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

    const freshImageUrl = await refresh(item.id, true)
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
              itemId={item.id}
              previewSrc={previewSrc}
              alt={item.fileName ?? item.title}
              isSvg={item.fileName?.toLowerCase().endsWith('.svg') ?? false}
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
    <div className="flex items-center gap-3 rounded-lg border border-border bg-muted px-3 py-2.5 transition-colors hover:bg-muted/60 hover:border-border/80">
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
  /**
   * Ref the parent Sheet reads on Esc/backdrop/swipe so those close paths also run through the
   * unsaved-explanation guard (mirrors the edit form's dirty guard).
   */
  sheetCloseRef?: SheetCloseRef
  // Fires with the full updated item after an AI result is persisted (explanation saved to the
  // description, or optimized prompt applied to the content), so the drawer reflects the change
  // immediately and it survives reopen (mirrors the edit form's onSave).
  onAiResultSaved?: (updated: FullItem) => void
  /** Mobile full-screen mode: render as document-flow content so the browser URL bar can collapse. */
  fullScreen?: boolean
}

export function ItemDrawerViewContent({ item, isLight, contentLoading = false, onClose, onEdit, onDeleted, sheetCloseRef, onAiResultSaved, fullScreen = false }: ItemDrawerViewContentProps) {
  const { itemType } = item
  const fullItem = isFullItem(item) ? item : null
  const description = isFullItem(item) ? item.description : item.descriptionPreview

  const aiMutate = useAiMutation()

  const explain = useAiItemRewrite({
    item: fullItem,
    onSaved: onAiResultSaved,
    maxInputChars: EXPLAIN_MAX_INPUT_CHARS,
    inputCapNoun: 'explanation',
    generate: useCallback(async (target: FullItem) => {
      const { data, error } = await aiMutate('/ai/explain', { itemId: target.id })
      if (error || !data) return { ok: false, message: error?.message ?? 'Failed to explain code.' }
      return { ok: true, result: data.explanation }
    }, [aiMutate]),
    targetField: 'description',
    successMessage: 'Explanation saved as description',
    alwaysConfirmReplace: false,
  })
  const canExplain = fullItem !== null && ITEM_TYPES_WITH_CODE_EDITOR.has(itemType.name)

  const optimize = useAiItemRewrite({
    item: fullItem,
    onSaved: onAiResultSaved,
    maxInputChars: OPTIMIZE_MAX_INPUT_CHARS,
    inputCapNoun: 'optimization',
    generate: useCallback(async (target: FullItem) => {
      const { data, error } = await aiMutate('/ai/optimize', { itemId: target.id })
      if (error || !data) return { ok: false, message: error?.message ?? 'Failed to optimize prompt.' }
      return { ok: true, result: data.prompt }
    }, [aiMutate]),
    targetField: 'content',
    successMessage: 'Optimized prompt applied',
    alwaysConfirmReplace: true,
  })
  const canOptimize = fullItem !== null && ITEM_TYPES_WITH_PROMPT_OPTIMIZE.has(itemType.name)

  // Guard both the drawer close AND the switch to edit mode while an AI result (explanation or
  // optimized prompt) is generated but not yet persisted: entering edit unmounts this view, which
  // would silently discard the result. An item is either a code type (explain) or a prompt
  // (optimize), never both.
  const hasUnsavedAi = (canExplain && explain.hasUnsaved) || (canOptimize && optimize.hasUnsaved)
  const { handleOpenChange, confirmOpen, handleConfirmOpenChange, handleDiscard } = useDirtyGuard({
    isDirty: hasUnsavedAi,
    onClose,
  })

  // Which destination the open confirm dialog resolves to: closing the drawer, or switching to edit
  // mode. Both must confirm first, but they proceed to different places.
  const [pendingIntent, setPendingIntent] = useState<'close' | 'edit'>('close')

  const requestClose = () => {
    setPendingIntent('close')
    handleOpenChange(false)
  }

  // Edit entry point (action bar, "Add tags…", collections): confirm first when an AI result is
  // unsaved, otherwise switch to edit mode immediately.
  const requestEdit = () => {
    if (hasUnsavedAi) {
      setPendingIntent('edit')
      handleConfirmOpenChange(true)
    } else {
      onEdit()
    }
  }

  // Route Esc/backdrop/swipe (handled by the parent Sheet) through the close guard. Cleared on unmount.
  useRegisterSheetClose(sheetCloseRef, requestClose)

  // After the user resolves the unsaved-AI dialog, proceed to the recorded destination.
  const proceedAfterGuard = () => {
    handleConfirmOpenChange(false)
    if (pendingIntent === 'edit') {
      onEdit()
    } else {
      handleOpenChange(false, true)
    }
  }

  const handleGuardSave = async () => {
    const ok = canOptimize ? await optimize.save() : await explain.save()
    if (ok) proceedAfterGuard()
  }

  const handleGuardDiscard = () => {
    if (pendingIntent === 'edit') {
      handleConfirmOpenChange(false)
      onEdit()
    } else {
      handleDiscard()
    }
  }

  return (
    <>
    <DrawerLayout
      fullScreen={fullScreen}
      itemType={itemType}
      onClose={requestClose}
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
          onEdit={requestEdit}
          onDeleted={onDeleted}
        />
      }
    >
      {ITEM_TYPES_WITH_CONTENT.has(itemType.name) && (
        // No "Content" section label: the editor's own chrome header already identifies the block,
        // so the redundant title is dropped to give the content more room.
        <section className="flex shrink-0 flex-col">
          {isLight || contentLoading ? (
            <Skeleton className="w-full rounded-md h-[70dvh] min-h-[120px]" />
          ) : (
            // A definite 70dvh window with contained overscroll and internal scrolling
            // (same for code + markdown, all viewports), so the content block is the
            // dominant area, its bottom stays on-screen, and the drawer scrolls
            // vertically to reveal the Description section just below it.
            <div className="overflow-hidden rounded-lg flex flex-col h-[70dvh] min-h-[120px] [overscroll-behavior:contain]">
              <ItemContentView
                itemType={itemType.name}
                content={fullItem!.content}
                language={fullItem!.language}
                explain={canExplain ? explain : undefined}
                optimize={canOptimize ? optimize : undefined}
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
          <p className="text-sm leading-relaxed whitespace-pre-line">{description}</p>
        ) : (
          <p className="text-sm text-muted-foreground">—</p>
        )}
      </DrawerSection>

      {ITEM_TYPES_WITH_URL.has(itemType.name) && (
        <DrawerSection label="URL">
          {item.url ? (
            <a href={/^https?:\/\//i.test(item.url ?? '') ? item.url! : '#'} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1.5 text-sm text-primary underline-offset-4 hover:underline break-all">
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
          <Button variant="outline" size="sm" className="h-7 text-xs border-dashed text-muted-foreground" onClick={requestEdit}>
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
          <DrawerCollectionsSection item={fullItem} onEdit={requestEdit} />
          <DrawerDetailsSection item={fullItem} />
        </>
      )}
    </DrawerLayout>
    {/* canExplain (code types) and canOptimize (prompt type) are mutually exclusive — only one can be
        true for any given item. Both blocks share the same `confirmOpen`/`handleConfirmOpenChange` for
        the unsaved-guard dialog; a future item type satisfying both predicates would result in two dialogs
        sharing the same open state. Keep these two predicates non-overlapping. */}
    {canExplain && (
      <>
        <ConfirmDialog
          open={confirmOpen}
          onOpenChange={handleConfirmOpenChange}
          title="Unsaved explanation"
          description={explain.replacesExisting
            ? 'This code explanation hasn’t been saved. Save it as the item’s description (replacing the current one) or it will be lost.'
            : 'This code explanation hasn’t been saved. Save it as the item’s description or it will be lost.'}
          confirmLabel="Save as description"
          onConfirm={handleGuardSave}
          onDiscard={handleGuardDiscard}
          cancelLabel="Keep open"
          isPending={explain.isSaving}
        />
        <ConfirmDialog
          open={explain.replaceConfirmOpen}
          onOpenChange={explain.onReplaceConfirmOpenChange}
          title="Replace description?"
          description="This item already has a description. Saving the explanation will permanently replace it."
          confirmLabel="Replace"
          onConfirm={explain.confirmReplace}
          isPending={explain.isSaving}
        />
      </>
    )}
    {canOptimize && (
      <>
        <ConfirmDialog
          open={confirmOpen}
          onOpenChange={handleConfirmOpenChange}
          title="Unsaved optimized prompt"
          description="This optimized prompt hasn’t been applied. Apply it as the item’s content (replacing the current prompt) or it will be lost."
          confirmLabel="Apply"
          onConfirm={handleGuardSave}
          onDiscard={handleGuardDiscard}
          cancelLabel="Keep open"
          isPending={optimize.isSaving}
        />
        <ConfirmDialog
          open={optimize.replaceConfirmOpen}
          onOpenChange={optimize.onReplaceConfirmOpenChange}
          title="Replace prompt?"
          description="Applying the optimized prompt will permanently replace this item’s current content."
          confirmLabel="Replace"
          onConfirm={optimize.confirmReplace}
          isPending={optimize.isSaving}
        />
      </>
    )}
    </>
  )
}
