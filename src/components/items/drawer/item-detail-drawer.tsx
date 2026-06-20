'use client'

import { useState, useEffect, useRef } from 'react'
import type { Dialog } from '@base-ui/react/dialog'
import { Sheet, SheetContent, SheetTitle } from '@/components/ui/sheet'
import { useResizable } from '@/hooks/use-resizable'
import { useSwipeToDismiss } from '@/hooks/use-swipe-to-dismiss'
import { $api } from '@/lib/api/client'
import { ItemDrawerViewContent } from './item-drawer-view-content'
import { ItemDrawerEditContent } from './item-drawer-edit-content'
import { DrawerSkeleton } from './drawer-shared'
import { ITEM_TYPES_WITH_CONTENT } from '@/lib/utils/constants'
import type { LightItem, FullItem, ItemDetails, ItemContent } from '@/types/item'
import { isFullItem } from '@/types/item'

interface ItemDetailDrawerProps {
  item: LightItem | FullItem | null
  open: boolean
  onOpenChange: (open: boolean) => void
  onFullItemFetched: (item: FullItem) => void
  onItemSaved: (item: FullItem) => void
  onItemDeleted: (id: string) => void
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
  sheetCloseRef: { current: (() => void) | null }
}

function ItemDetailDrawerInner({
  item,
  onOpenChange,
  onFullItemFetched,
  onItemSaved,
  onItemDeleted,
  sheetCloseRef,
}: ItemDetailDrawerInnerProps) {
  const [editingItemId, setEditingItemId] = useState<string | null>(null)
  const [savedItem, setSavedItem] = useState<FullItem | null>(null)

  const itemId = item?.id ?? null
  const needsDetailsFetch = item !== null && !isFullItem(item)
  const needsContent = item !== null && ITEM_TYPES_WITH_CONTENT.has(item.itemType.name) && !isFullItem(item)

  const { data: fetchedDetails } = $api.useQuery(
    'get',
    '/items/{id}/details',
    { params: { path: { id: itemId ?? '' } } },
    { enabled: needsDetailsFetch && itemId !== null },
  )

  const { data: fetchedContent } = $api.useQuery(
    'get',
    '/items/{id}/content',
    { params: { path: { id: itemId ?? '' } } },
    { enabled: needsContent && itemId !== null },
  )

  const { data: collections = [] } = $api.useQuery(
    'get',
    '/collections',
    {},
    { enabled: editingItemId !== null },
  )

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

  useEffect(() => {
    if (!item || !details) return
    const merged = mergeDrawerItem(item, details, content) as FullItem
    if (content || !ITEM_TYPES_WITH_CONTENT.has(item.itemType.name)) {
      onFullItemFetched(merged)
    }
  }, [item, details, content, onFullItemFetched])

  const displayItem = savedItem ?? (item && details ? mergeDrawerItem(item, details, content) : item)
  const detailsLoaded = Boolean(details) || Boolean(savedItem) || (item !== null && isFullItem(item))
  const contentLoaded =
    !item ||
    !ITEM_TYPES_WITH_CONTENT.has(item.itemType.name) ||
    Boolean(content) ||
    Boolean(savedItem) ||
    (item !== null && isFullItem(item))
  const isLight = !detailsLoaded
  const contentLoading = detailsLoaded && !contentLoaded
  const editing = editingItemId !== null && editingItemId === displayItem?.id && contentLoaded

  return (
    <>
      <SheetTitle className="sr-only">{displayItem?.title ?? 'Item details'}</SheetTitle>

      {!displayItem ? (
        <DrawerSkeleton />
      ) : editing ? (
        <ItemDrawerEditContent
          item={displayItem as FullItem}
          collections={collections}
          onClose={() => onOpenChange(false)}
          onSave={(updated: FullItem) => {
            setSavedItem(updated)
            setEditingItemId(null)
            onItemSaved(updated)
          }}
          onCancel={() => setEditingItemId(null)}
          sheetCloseRef={sheetCloseRef}
        />
      ) : (
        <ItemDrawerViewContent
          item={displayItem}
          isLight={isLight}
          contentLoading={contentLoading}
          onClose={() => onOpenChange(false)}
          onEdit={() => contentLoaded && setEditingItemId(displayItem.id)}
          onDeleted={() => {
            onItemDeleted(displayItem.id)
            onOpenChange(false)
          }}
          sheetCloseRef={sheetCloseRef}
          onAiResultSaved={(updated) => {
            setSavedItem(updated)
            onItemSaved(updated)
          }}
        />
      )}
    </>
  )
}

export function ItemDetailDrawer({
  item,
  open,
  onOpenChange,
  onFullItemFetched,
  onItemSaved,
  onItemDeleted,
}: ItemDetailDrawerProps) {
  const { width, dragging, startResize, onMouseMove, onMouseUp } = useResizable({
    defaultWidth: 560,
    maxBoundarySelector: 'main',
    maxBoundaryGapVw: 0.1,
  })

  // Outside-press / Esc / swipe all funnel through here. The edit (and read) content registers a
  // mode-aware guarded close in sheetCloseRef, so every dismissal is intercepted: edit mode prompts
  // to discard unsaved changes, view mode closes directly. We do NOT disable dismissal while
  // editing — silently swallowing a backdrop click or swipe felt broken; routing through the guard
  // shows the discard dialog instead.
  const sheetCloseRef = useRef<(() => void) | null>(null)

  function handleSheetOpenChange(nextOpen: boolean, eventDetails?: Dialog.Root.ChangeEventDetails) {
    if (nextOpen) {
      onOpenChange(true)
      return
    }
    // The markdown editor/viewer is portaled OUT of the drawer's DOM (on touch and in fullscreen),
    // so a press inside it reads as a base-ui "outside press". Ignore those — interacting with the
    // editor must never dismiss the drawer (otherwise every tap-to-type would pop the guard).
    if (eventDetails?.reason === 'outside-press') {
      const target = eventDetails.event.target
      if (target instanceof Element && target.closest('[data-editor-overlay]')) {
        eventDetails.cancel()
        return
      }
    }
    if (sheetCloseRef.current) {
      sheetCloseRef.current()
    } else {
      onOpenChange(false)
    }
  }

  const swipe = useSwipeToDismiss({
    // Enabled while editing too (no `enabled` gate): a genuine dismiss swipe funnels through the
    // guarded close above. useSwipeToDismiss already ignores swipes that begin in the editor or any
    // scroller, so this never fires from normal editing interactions.
    onDismiss: () => handleSheetOpenChange(false),
  })

  return (
    <Sheet open={open} onOpenChange={handleSheetOpenChange}>
      <SheetContent
        side="right"
        // Mobile: full-width so the content area is maximised and nothing is cut off.
        // Desktop (sm+): the resizable px width from useResizable.
        className="flex flex-col gap-0 p-0 max-sm:!w-full"
        // dragStyle drives the touch swipe-to-dismiss drag (a gesture can't be expressed with
        // classes); width/maxWidth are the pre-existing resize sizing.
        style={{ width, maxWidth: 'none', ...swipe.dragStyle }}
        showCloseButton={false}
        {...swipe.handlers}
      >
        {/* Desktop resize handle: a thin strip along the inner (left) edge. The centered pill
            is a visual grip affordance signalling the drawer can be dragged wider/narrower —
            it brightens on hover and while dragging. Hidden on mobile, which swipes to dismiss. */}
        <div
          className={`group absolute left-0 top-0 z-10 flex h-full w-1.5 cursor-ew-resize items-center justify-center transition-colors max-sm:hidden ${dragging ? 'bg-primary/40' : 'hover:bg-primary/30'}`}
          onMouseDown={startResize}
        >
          <div
            aria-hidden="true"
            className={`h-10 w-1 rounded-full transition-colors ${dragging ? 'bg-primary' : 'bg-foreground/20 group-hover:bg-primary/60'}`}
          />
        </div>

        {/* Mobile-only grab affordance: a vertical pill on the inner (left) edge mirroring the
            bottom sheet's top handle, signalling the drawer can be swiped right to dismiss. The
            swipe gesture lives on the whole SheetContent, so this is purely visual. Hidden on
            sm+, which has the resize handle and pointer dismissal instead. Brightens while pressed
            (active:) so the grip reacts to touch — mirrors the desktop resize pill's drag feedback. */}
        <div
          aria-hidden="true"
          className="absolute left-1 top-1/2 z-10 h-10 w-1.5 -translate-y-1/2 rounded-full bg-foreground/20 transition-colors active:bg-primary/70 sm:hidden"
        />

        {dragging && (
          <div
            className="fixed inset-0 z-[60] cursor-ew-resize select-none"
            onMouseMove={onMouseMove}
            onMouseUp={onMouseUp}
          />
        )}

        {item ? (
          <ItemDetailDrawerInner
            key={item.id}
            item={item}
            onOpenChange={onOpenChange}
            onFullItemFetched={onFullItemFetched}
            onItemSaved={onItemSaved}
            onItemDeleted={onItemDeleted}
            sheetCloseRef={sheetCloseRef}
          />
        ) : (
          <>
            <SheetTitle className="sr-only">Loading…</SheetTitle>
            <DrawerSkeleton />
          </>
        )}
      </SheetContent>
    </Sheet>
  )
}
