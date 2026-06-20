'use client'

import { useState, useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'
import type { Dialog } from '@base-ui/react/dialog'
import { Sheet, SheetContent, SheetTitle } from '@/components/ui/sheet'
import { useResizable } from '@/hooks/use-resizable'
import { useSwipeToDismiss } from '@/hooks/use-swipe-to-dismiss'
import { usePressHighlight } from '@/hooks/use-press-highlight'
import { useEditorFullscreenStore } from '@/stores/editor-fullscreen'
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
  const grip = usePressHighlight()
  // A maximized content editor covers the whole drawer; swipe-to-dismiss is disabled while it is
  // fullscreen so a swipe over the editor can't close the drawer — the user collapses it first.
  const editorFullscreen = useEditorFullscreenStore((s) => s.fullscreen)

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
    // scroller, so this never fires from normal editing interactions. The same instance also backs
    // the portaled grab handle below — distanceThreshold keeps the dismiss distance sane when the
    // gesture starts on that small handle (its width would make the fractional threshold tiny).
    onDismiss: () => handleSheetOpenChange(false),
    distanceThreshold: 90,
    enabled: !editorFullscreen,
  })

  // The grab handle is portaled to <body> (it must paint above the editor/viewer overlay, itself a
  // body portal that covers the drawer), so it lives OUTSIDE the drawer's DOM and can't inherit the
  // drawer's open/close/drag transform. To keep it STRICTLY bound to the drawer's edge with zero
  // drift, we mirror that transform every frame: read the drawer's live left edge and translate the
  // handle's rail to match. This holds through the open slide, the close slide, and a swipe-drag (the
  // drawer already carries the drag offset, so mirroring its rect moves the handle with it). Direct
  // style writes via a ref — no setState, so it never re-renders or trips set-state-in-effect. The
  // rail's initial translateX(100vw) matches the drawer's off-screen start, so it never flashes at
  // the left edge on mount before the first frame runs.
  const railRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open || editorFullscreen) return
    let raf = 0
    // The right sheet element is stable while open, so query it once and cache it rather than every
    // frame; the `??=` re-queries only until it first appears (the portal may mount a frame after this
    // effect runs). document is required: the sheet is portaled outside this component's subtree, so
    // there is no React ref to it here.
    let sheet: Element | null = null
    const sync = () => {
      sheet ??= document.querySelector('[data-slot="sheet-content"][data-side="right"]')
      const rail = railRef.current
      if (rail && sheet) {
        rail.style.transform = `translateX(${sheet.getBoundingClientRect().left}px)`
      }
      raf = requestAnimationFrame(sync)
    }
    raf = requestAnimationFrame(sync)
    return () => cancelAnimationFrame(raf)
  }, [open, editorFullscreen])

  return (
    <>
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
        {/* Desktop resize handle: a thin strip along the inner (left) edge — drag to widen/narrow
            the drawer. No always-visible grip pill (it read as a swipe indicator on desktop); the
            strip itself brightens on hover and while dragging. Hidden on mobile, which uses the
            swipe-to-dismiss grab handle instead. */}
        <div
          className={`absolute left-0 top-0 z-10 h-full w-1.5 cursor-ew-resize transition-colors max-sm:hidden ${dragging ? 'bg-primary/40' : 'hover:bg-primary/30'}`}
          onMouseDown={startResize}
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

      {/* Mobile-only swipe-to-dismiss grab handle, PORTALED to <body> at z-[55]. It must live above
          the markdown editor/viewer, which is itself portaled to <body> as a fixed z-50 overlay that
          covers the drawer content — a handle rendered inside the drawer (a lower stacking context)
          sits *behind* that overlay, so presses and swipes never reach it (the old "pixel-perfect"
          bug). This is a LARGE transparent hit area: a press anywhere in it highlights the pill and
          starts the gesture, no precise aim needed. It shares the drawer's `swipe` instance, so the
          drawer still follows the finger; `distanceThreshold` keeps the dismiss distance sane given
          the handle's small width. `touch-none` makes the engine yield the horizontal swipe to our
          JS rather than the browser's edge "back" gesture; the pill sits a little in from the screen
          edge so the press starts outside the OS edge-back zone. It overlays the drawer's left edge
          without changing layout, so the content keeps its full width. Hidden on sm+ (resize handle
          + backdrop there). Only mounted while open. */}
      {open &&
        !editorFullscreen &&
        typeof document !== 'undefined' &&
        createPortal(
          // Full-height, click-through centering rail. Portaled to <body> so it sits ABOVE the editor
          // overlay (itself a fixed z-50 body portal that covers the drawer) — a handle rendered inside
          // the drawer would be behind it. Its translateX is driven imperatively by the mirror effect
          // above (railRef), which keeps it locked to the drawer's live left edge through the open
          // slide, close slide, and swipe-drag. The initial inline translateX(100vw) matches the
          // drawer's off-screen start so it never flashes at the left before the first frame, and it's
          // a constant React never rewrites, so the effect's per-frame writes survive re-renders. It
          // unmounts the instant `open` flips or the editor goes fullscreen (swipe is disabled then —
          // the user collapses the editor before swiping closed). The rail centres the handle
          // vertically; the INNER handle owns the press/swipe gesture.
          <div
            ref={railRef}
            style={{ transform: 'translateX(100vw)' }}
            className="pointer-events-none fixed inset-y-0 left-0 z-[55] flex items-center sm:hidden"
          >
            <div
              aria-hidden="true"
              {...swipe.handlers}
              {...grip.handlers}
              className="pointer-events-auto flex h-3/5 max-h-72 min-h-40 w-16 touch-none items-center justify-start pl-1.5"
            >
              {/* Visible pill hugs the drawer's edge (not over the content); the transparent hit area
                  extends inward, on top of the content, so a press anywhere in it starts the gesture. */}
              <div className={`h-14 w-1.5 rounded-full transition-colors ${grip.pressed ? 'bg-primary/70' : 'bg-foreground/20'}`} />
            </div>
          </div>,
          document.body,
        )}
    </>
  )
}
