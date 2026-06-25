'use client'

import { useState, useEffect, useLayoutEffect, useRef } from 'react'
import { motion } from 'motion/react'
import { SheetTitle } from '@/components/ui/sheet'
import { DrawerShell } from './drawer-shell'
import { useEditorFullscreenStore } from '@/stores/editor-fullscreen'
import { useItemDrawerStore } from '@/stores/item-drawer-store'
import { useItemDetails, useItemContent } from '@/hooks/items/use-item-detail'
import { ItemDrawerViewContent } from './item-drawer-view-content'
import { ItemDrawerEditContent } from './item-drawer-edit-content'
import { DrawerSkeleton, SWIPE_GRIP_PILL_CLASS, GRIP_VARIANTS } from './drawer-shared'
import { useMotionSwipeClose } from '@/hooks/ui/use-motion-swipe-close'
import type { SheetCloseRef } from '@/hooks/ui/use-register-sheet-close'
import { cn } from '@/lib/utils'
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

  const displayItem = savedItem ?? mergedItem
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

  let body
  if (!displayItem) {
    body = <DrawerSkeleton fullScreen={fullScreen} />
  } else if (editing) {
    body = (
      <ItemDrawerEditContent
        item={displayItem as FullItem}
        fullScreen={fullScreen}
        onClose={() => onOpenChange(false)}
        onSave={(updated: FullItem) => {
          setSavedItem(updated)
          setEditingItemId(null)
        }}
        onCancel={() => setEditingItemId(null)}
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
        onClose={() => onOpenChange(false)}
        onEdit={() => contentLoaded && setEditingItemId(displayItem.id)}
        onDeleted={() => onOpenChange(false)}
        sheetCloseRef={sheetCloseRef}
        onAiResultSaved={(updated) => setSavedItem(updated)}
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
 * Mobile full-screen item view. Renders the SAME body as the desktop drawer, but as document-flow
 * content (no Sheet overlay, no fixed positioning, no scroll-lock) so it becomes the page's scrollable
 * content — which lets the mobile browser retract its URL bar on scroll, exactly like the dashboard. The
 * provider mounts this instead of the Sheet on touch; the page behind it is hidden so this is the sole
 * document content. Close is driven by the in-content X/Cancel (→ onOpenChange(false), already routed
 * through the dirty guard), by browser Back (via ItemDrawerUrlSync clearing `?item`), and by a
 * swipe-right gesture that routes through the body's guarded close (`sheetCloseRef`) so an unsaved edit
 * still prompts to discard. There is no Sheet here, so no Esc/backdrop dismissal.
 */
interface ItemFullScreenViewProps extends Omit<ItemDetailDrawerProps, 'open'> {
  // Signals the slider that a swipe gesture has ALREADY animated the item off-screen, so it must skip its
  // own reverse-slide and go straight to idle when the close commits — avoiding the double animation / jump.
  // This is a SIGNAL ONLY: it does not commit the close. The actual close still runs through the guarded
  // `requestClose` below, so an unsaved edit prompts to discard before anything closes (the discard dialog
  // shows over the page revealed by the swipe; on cancel the item springs back into place).
  onSwipeCloseStart?: () => void
  // True when the slider mounts this as the settled, sole document content (vs. the moving open/close slide
  // overlay). Used to enable the swipe-to-close drag + grip only once the item is the document.
  isSettled?: boolean
}

export function ItemFullScreenView({
  item,
  onOpenChange,
  onFullItemFetched,
  onSwipeCloseStart,
  isSettled = false,
}: ItemFullScreenViewProps) {
  const sheetCloseRef = useRef<(() => void) | null>(null)
  // A maximized editor covers the view and owns its own gestures — disable swipe-to-close while it is up
  // (mirrors DrawerShell), so a horizontal swipe over the editor can't close the view underneath it.
  const editorFullscreen = useEditorFullscreenStore((s) => s.fullscreen)

  // Route a close request through the body's guarded close (sheetCloseRef) so an unsaved edit prompts
  // first; once cleared the body calls onOpenChange(false). Falls back to a direct close in view mode.
  const requestClose = () => {
    const guardedClose = sheetCloseRef.current
    if (guardedClose) guardedClose()
    else onOpenChange(false)
  }

  const isOpen = useItemDrawerStore((s) => s.isOpen)

  const { x, panelRef, gripPressed, setGripPressed, dragEnabled, handleDrag, handleDragEnd } = useMotionSwipeClose({
    isOpen,
    isSettled,
    editorFullscreen,
    onSwipeCloseStart,
    requestClose,
  })

  // Switching directly from one open item to another (no unmount) — jump back to the top so the new item
  // starts at its header instead of inheriting the previous item's scroll. ONLY in settled mode (signalled
  // by `isSettled`, which the slider passes only when the item IS the document scroller). During the
  // open SLIDE the item is a fixed overlay, not the document — resetting the document scroll there would
  // disturb the kept-mounted page sitting behind it.
  const openItemId = item?.id ?? null
  useLayoutEffect(() => {
    if (openItemId === null || !isSettled) return
    // document required: in settled mode the item IS the page document, so resetting its scroll means
    // the document scroller — there is no React/Next alternative for the document-level scroll position.
    const scroller = document.scrollingElement ?? document.documentElement
    scroller.scrollTop = 0
    // Reset the live drag offset too: switching items mid-drag or mid fly-off (deep-link / programmatic
    // swap) would otherwise leave the new item rendered partially translated by the previous item's `x`.
    x.set(0)
    // x is a stable useMotionValue ref — intentionally excluded from deps.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [openItemId, isSettled])

  if (!item) return null
  return (
    /* Drag wrapper: Motion's drag gesture carries the item (with its own opaque app background) so a
          rightward drag reveals the kept-mounted page behind it (the slider's pageLayer). dragDirectionLock
          lets vertical gestures fall through to document scroll (URL-bar retraction).
          NO dragConstraints/dragElastic/dragMomentum: each of those engages Motion's built-in release
          animator, which fires its own settle on `x` at pointer-up and races our handleDragEnd animation on
          the same value — the item snaps to fully-open for a frame, then our fly-off/unmount runs (the
          "appears fully open, then disappears/jumps" bug). Without them, handleDragEnd is the SOLE animator
          on release: it either flies the item off from the current x (dismiss) or springs it back to 0
          (below threshold) — the close always continues from where the finger lifted. Leftward over-drag is
          clamped in onDrag (handleDrag) instead. min-h-[100lvh] keeps the opaque bg covering the full
          height. */
    <motion.div
      ref={panelRef}
      drag={dragEnabled ? 'x' : false}
      dragDirectionLock
      whileDrag="dragging"
      onDrag={handleDrag}
      onDragEnd={handleDragEnd}
      style={{ x }}
      className="app-dot-grid relative min-h-[100lvh] touch-pan-y bg-background shadow-[-8px_0_24px_rgba(0,0,0,0.25)]"
    >
      <div aria-hidden className="pointer-events-none absolute left-1/3 top-0 -z-10 h-[500px] w-[600px] -translate-x-1/2 rounded-full bg-blue-500/[0.08] blur-3xl" />
      <div aria-hidden className="pointer-events-none absolute right-0 top-1/3 -z-10 h-[400px] w-[500px] rounded-full bg-cyan-500/[0.06] blur-3xl" />

      {/* Swipe-to-dismiss indicator: a vertical grip pill at the drawer's left edge — the touch affordance
          for the rightward swipe-to-close, the same pill the desktop Sheet uses (drawer-shell). It lives
          INSIDE the panel, so it rides in WITH the drawer during the open slide and travels right with the
          drag (it inherits the panel's transform) — never stranded on the screen edge before the drawer
          arrives, and always present on the drawer in every state. The OUTER layer is `absolute inset-y-0`
          (out of flow, spans the panel's full height, so it adds no layout). The INNER `sticky top-0
          h-[100lvh] items-center` column pins to the viewport top as the panel scrolls, so its centred pill
          stays at the SCREEN's vertical middle (not the tall content's middle) and never drifts with the
          URL bar. Inert; only the pill paints. The `dragging` variant — propagated from the panel's
          whileDrag — highlights it (primary) while a drag is active, idle otherwise; no React state. */}
      {!editorFullscreen ? (
        <div aria-hidden className="pointer-events-none absolute inset-y-0 left-0 z-[55] w-2">
          <div className="sticky top-0 flex h-[100lvh] flex-col items-start justify-center pl-1">
            <motion.div
              // pointer-events-auto only on the pill so a tap highlights it; the pointerdown still bubbles
              // to the panel and starts Motion's drag (no capture here, see gripPressed above). animate
              // follows the press; whileDrag keeps it lit through an actual drag (variant from the panel).
              className={cn(SWIPE_GRIP_PILL_CLASS, 'pointer-events-auto touch-none')}
              variants={GRIP_VARIANTS}
              initial="idle"
              animate={gripPressed ? 'dragging' : 'idle'}
              onPointerDown={() => setGripPressed(true)}
              onPointerUp={() => setGripPressed(false)}
              onPointerCancel={() => setGripPressed(false)}
              onPointerLeave={() => setGripPressed(false)}
            />
          </div>
        </div>
      ) : null}

      <ItemDetailDrawerInner
        key={item.id}
        item={item}
        fullScreen
        onOpenChange={onOpenChange}
        onFullItemFetched={onFullItemFetched}
        sheetCloseRef={sheetCloseRef}
      />
    </motion.div>
  )
}

