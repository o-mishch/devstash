'use client'

import { useState, useEffect, useCallback } from 'react'
import { SheetTitle } from '@/components/ui/sheet'
import { DrawerShell } from './drawer-shell'
import { useItemDetails, useItemContent } from '@/hooks/items/use-item-detail'
import { ItemDrawerViewContent } from './item-drawer-view-content'
import { ItemDrawerEditContent } from './item-drawer-edit-content'
import { DrawerSkeleton } from './drawer-shared'
import type { SheetCloseRef } from '@/hooks/ui/use-register-sheet-close'
import { ITEM_TYPES_WITH_CONTENT } from '@/lib/utils/constants'
import type { LightItem, FullItem, ItemDetails, ItemContent } from '@/types/item'
import { isFullItem } from '@/types/item'


interface ItemDetailDrawerProps {
  item: LightItem | FullItem | null
  open: boolean
  onOpenChange: (open: boolean) => void
  onFullItemFetched: (item: FullItem) => void
}

function mergeDrawerItem(
  base: LightItem | FullItem,
  details: ItemDetails | null,
  content: ItemContent | null,
): LightItem | FullItem {
  if (!details) return base
  return {
    ...base,
    ...details,
    content: content?.content ?? ('content' in base ? base.content : null),
    language: content?.language ?? ('language' in base ? base.language : null),
  }
}

interface ItemDetailDrawerInnerProps extends Omit<ItemDetailDrawerProps, 'open'> {
  /**
   * Sheet-level guarded close (Esc / backdrop / swipe) the body registers via useRegisterSheetClose.
   * Present in Sheet mode; omitted in full-screen mode, which has no Sheet — there the in-content
   * X/Cancel already route through the dirty guard, and browser Back drives close (see ItemFullScreenView).
   */
  sheetCloseRef?: SheetCloseRef
  /**
   * Full-screen (mobile) mode: render the body as document-flow content (no Sheet shell) so the <html>
   * document scrolls and the browser URL bar can retract. Also swaps the Radix `SheetTitle` (which must
   * live inside a Dialog) for a plain screen-reader heading, since there is no Sheet in this mode.
   */
  fullScreen?: boolean
}

// The shell-agnostic drawer body: the progressive details/content fetch, the view/edit toggle, and the
// post-save reconciliation. Used by the desktop Sheet (ItemDetailDrawer) AND the mobile full-screen
// page (ItemFullScreenView), which renders it as document content so the browser URL bar can collapse.
function ItemDetailDrawerInner({
  item,
  onOpenChange,
  onFullItemFetched,
  sheetCloseRef,
  fullScreen = false,
}: ItemDetailDrawerInnerProps) {
  const [editingItemId, setEditingItemId] = useState<string | null>(null)
  const [savedItem, setSavedItem] = useState<FullItem | null>(null)

  const itemId = item?.id ?? null
  const needsDetailsFetch = item !== null && !isFullItem(item)
  const needsContent = item !== null && ITEM_TYPES_WITH_CONTENT.has(item.itemType.name) && !isFullItem(item)

  const { data: fetchedDetails } = useItemDetails(itemId, { enabled: needsDetailsFetch })
  const { data: fetchedContent } = useItemContent(itemId, { enabled: needsContent })

  const initialDetails: ItemDetails | null =
    item && isFullItem(item)
      ? { description: item.description, updatedAt: item.updatedAt, collections: item.collections }
      : null
  const initialContent: ItemContent | null =
    item && isFullItem(item) && ITEM_TYPES_WITH_CONTENT.has(item.itemType.name)
      ? { content: item.content, language: item.language }
      : null

  const details = fetchedDetails ?? initialDetails
  const content = fetchedContent ?? initialContent

  const mergedItem = item && details ? mergeDrawerItem(item, details, content) : item

  useEffect(() => {
    // Once a save has produced `savedItem`, useUpdateItem has already seeded all three detail caches with
    // the persisted item — re-seeding here would clobber them with a stale `mergedItem`, which is still
    // built from the pre-save base `item` (notably its old `itemType` on a live type change). Skip.
    if (savedItem) return
    if (!item || !details || !mergedItem) return
    if (content || !ITEM_TYPES_WITH_CONTENT.has(item.itemType.name)) {
      onFullItemFetched(mergedItem as FullItem)
    }
  }, [item, savedItem, details, content, mergedItem, onFullItemFetched])

  // Stable references: both feed a downstream `useDirtyGuard`/`useAiItemRewrite` dependency array
  // (via ItemDrawerViewContent), so a fresh closure on every render would defeat those hooks'
  // memoization. `onDeleted` performs the same "close the drawer" action as `onClose`, so it reuses
  // the same stable callback rather than allocating an equivalent one.
  const handleClose = useCallback(() => onOpenChange(false), [onOpenChange])
  const handleAiResultSaved = useCallback((updated: FullItem) => setSavedItem(updated), [])
  const handleEditSave = useCallback((updated: FullItem) => {
    setSavedItem(updated)
    setEditingItemId(null)
  }, [])
  const handleEditCancel = useCallback(() => setEditingItemId(null), [])

  const displayItem = savedItem ?? mergedItem
  const detailsLoaded = Boolean(details) || Boolean(savedItem) || (item !== null && isFullItem(item))
  const contentLoaded =
    !item ||
    !ITEM_TYPES_WITH_CONTENT.has(item.itemType.name) ||
    Boolean(content) ||
    Boolean(savedItem) ||
    (item !== null && isFullItem(item))
  const isLight = !detailsLoaded
  const handleStartEdit = useCallback(() => {
    if (contentLoaded && displayItem) setEditingItemId(displayItem.id)
  }, [contentLoaded, displayItem])
  const contentLoading = detailsLoaded && !contentLoaded
  const editing = editingItemId !== null && editingItemId === displayItem?.id && contentLoaded

  let body
  if (!displayItem) {
    body = <DrawerSkeleton fullScreen={fullScreen} />
  } else if (editing) {
    body = (
      <ItemDrawerEditContent
        item={displayItem as FullItem}
        fullScreen={fullScreen}
        onClose={handleClose}
        onSave={handleEditSave}
        onCancel={handleEditCancel}
        sheetCloseRef={sheetCloseRef}
      />
    )
  } else {
    body = (
      <ItemDrawerViewContent
        item={displayItem}
        isLight={isLight}
        contentLoading={contentLoading}
        fullScreen={fullScreen}
        onClose={handleClose}
        onEdit={handleStartEdit}
        onDeleted={handleClose}
        sheetCloseRef={sheetCloseRef}
        onAiResultSaved={handleAiResultSaved}
      />
    )
  }

  const title = displayItem?.title ?? 'Item details'
  return (
    <>
      {/* SheetTitle is a Radix Dialog primitive — only valid inside the Sheet. Full-screen mode has no
          Sheet, so use a plain visually-hidden heading for the same screen-reader labelling. */}
      {fullScreen ? <h1 className="sr-only">{title}</h1> : <SheetTitle className="sr-only">{title}</SheetTitle>}
      {body}
    </>
  )
}

export function ItemDetailDrawer({
  item,
  open,
  onOpenChange,
  onFullItemFetched,
}: ItemDetailDrawerProps) {
  // The Sheet shell (resize, swipe-to-dismiss, grab handle, editor-fullscreen gate, and the close-ref
  // plumbing that routes Esc/backdrop/swipe through the body's dirty guard) is shared with the Brain
  // Dump draft drawer via DrawerShell. Only the body differs.
  return (
    <DrawerShell open={open} onOpenChange={onOpenChange}>
      {(sheetCloseRef) =>
        item ? (
          <ItemDetailDrawerInner
            key={item.id}
            item={item}
            onOpenChange={onOpenChange}
            onFullItemFetched={onFullItemFetched}
            sheetCloseRef={sheetCloseRef}
          />
        ) : (
          <>
            <SheetTitle className="sr-only">Loading…</SheetTitle>
            <DrawerSkeleton />
          </>
        )
      }
    </DrawerShell>
  )
}

/**
 * Mobile full-screen item view — the document-flow BODY rendered inside MobileDrawerHost's shared panel
 * (the same host the brain-dump draft drawer uses). Renders the SAME body as the desktop drawer but as
 * document content (no Sheet overlay, no fixed positioning, no scroll-lock) so it becomes the page's
 * scrollable content, letting the mobile browser retract its URL bar on scroll. The host owns the slider +
 * swipe-close panel; this is just the body. Close is driven by the in-content X/Cancel (→ onOpenChange(false),
 * already routed through the dirty guard), by browser Back (via ItemDrawerUrlSync clearing `?item`), and by
 * the host's swipe-right gesture which routes through this body's guarded close (`sheetCloseRef`) so an
 * unsaved edit still prompts to discard. There is no Sheet here, so no Esc/backdrop dismissal.
 */
interface ItemFullScreenViewProps extends Omit<ItemDetailDrawerProps, 'open'> {
  // Provided by MobileDrawerHost — the body registers its guarded close (dirty-prompt) into it so a
  // swipe-dismiss prompts before discarding an unsaved edit.
  sheetCloseRef: SheetCloseRef
}

export function ItemFullScreenView({
  item,
  onOpenChange,
  onFullItemFetched,
  sheetCloseRef,
}: ItemFullScreenViewProps) {
  if (!item) return null
  return (
    <ItemDetailDrawerInner
      key={item.id}
      item={item}
      fullScreen
      onOpenChange={onOpenChange}
      onFullItemFetched={onFullItemFetched}
      sheetCloseRef={sheetCloseRef}
    />
  )
}

