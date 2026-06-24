'use client'

import { useState, useEffect, useLayoutEffect, useRef } from 'react'
import { motion, useMotionValue, animate, type PanInfo, type Variants } from 'motion/react'
import { SheetTitle } from '@/components/ui/sheet'
import { DrawerShell } from './drawer-shell'
import { useEditorFullscreenStore } from '@/stores/editor-fullscreen'
import { useItemDrawerStore } from '@/stores/item-drawer-store'
import { useItemDetails, useItemContent } from '@/hooks/use-item-detail'
import { ItemDrawerViewContent } from './item-drawer-view-content'
import { ItemDrawerEditContent } from './item-drawer-edit-content'
import { DrawerSkeleton, SWIPE_GRIP_PILL_CLASS } from './drawer-shared'
import type { SheetCloseRef } from '@/hooks/use-register-sheet-close'
import { cn } from '@/lib/utils'
import { ITEM_TYPES_WITH_CONTENT } from '@/lib/utils/constants'
import type { LightItem, FullItem, ItemDetails, ItemContent } from '@/types/item'
import { isFullItem } from '@/types/item'
import { shouldDismissSwipe } from '@/lib/utils/swipe'

// Swipe-grip pill states. The parent drag panel's `whileDrag="dragging"` propagates to this child variant
// (Motion variants flow down the tree), so the pill colours itself while a drag is active — primary at 70%,
// muted foreground at 30% otherwise — without any React state. color-mix mirrors Tailwind's `/NN` alpha.
const GRIP_VARIANTS: Variants = {
  idle: { backgroundColor: 'color-mix(in oklch, var(--foreground) 30%, transparent)' },
  dragging: { backgroundColor: 'color-mix(in oklch, var(--primary) 70%, transparent)' },
}

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

  // `x` is the live horizontal swipe-drag position (px); `panelRef` is the dragged panel. Declared up here
  // so the scroll-reset effect below can also clear `x` on an item switch (see that effect). Motion's
  // `drag="x"` + `dragDirectionLock` only locks an axis after the first pointer movement, so a VERTICAL-first
  // gesture locks to Y, Motion does NOT capture it, and native document scroll proceeds (URL-bar retraction).
  const x = useMotionValue(0)
  const panelRef = useRef<HTMLDivElement>(null)

  // Press-highlight for the swipe grip: a plain tap on the indicator lights it up (matching the desktop
  // Sheet's grip via usePressHighlight), even before any drag begins — `whileDrag` only covers the drag
  // itself. We do NOT use usePressHighlight here because it pointer-captures the handle: the full-screen
  // panel's swipe is Motion's pointer-based `drag`, so capturing on the grip would steal the move events
  // and break swipe-from-grip. Instead the grip stays event-transparent to the drag (no capture) — the
  // pointerdown still bubbles to the panel and starts Motion's drag — and we only flip a visual flag.
  const [gripPressed, setGripPressed] = useState(false)

  // Open/close ANIMATION is owned by MobileItemPaneSlider (the paired page↔item slide). This view is just
  // the settled, static content: body + app background + swipe-to-close. Closing simply calls
  // onOpenChange(false) — the slider plays the reverse slide and commits the store close.

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

  // Route a close request through the body's guarded close (sheetCloseRef) so an unsaved edit prompts
  // first; once cleared the body calls onOpenChange(false). Falls back to a direct close in view mode.
  const requestClose = () => {
    const guardedClose = sheetCloseRef.current
    if (guardedClose) guardedClose()
    else onOpenChange(false)
  }

  // Commit a swipe close AFTER the fly-off has animated the item off-screen. The swipe must NOT bypass the
  // dirty-edit guard (data loss on swipe), so the close always runs through `requestClose`:
  //  • Clean — the guard closes synchronously; `onSwipeCloseStart` told the slider to skip its reverse slide,
  //    so it goes straight to idle with no double animation.
  //  • Dirty — the guard opens the discard dialog instead of closing. We detect that on the next frame (the
  //    drawer is still open in the store) and spring the item back to x:0 so it sits in place behind the
  //    dialog; the `onSwipeCloseStart` skip flag is harmless because no close commits until the user confirms.
  const commitSwipeClose = () => {
    onSwipeCloseStart?.()
    requestClose()
    // Spring back if the close was DEFERRED (dirty-guard opened a discard dialog): the item is still
    // open and must return to x:0 so the dialog sits over it in place. Zustand's set() is synchronous,
    // so getState().isOpen is already false by this rAF for a clean close — no state-flush race.
    // Sequential (not concurrent): this rAF fires AFTER the fly-off tween's onComplete, so x is already at
    // target. A second animate(x, 0) here springs it back from that parked position — Motion treats them as
    // two separate animations, not a cancellation race.
    requestAnimationFrame(() => {
      if (useItemDrawerStore.getState().isOpen) animate(x, 0, { type: 'spring', stiffness: 500, damping: 40 })
    })
  }

  // --- Swipe-right-to-close, built on Motion's drag gesture (out-of-the-box) ---
  // (`x` / `panelRef` declared above.) A clear rightward drag locks to X and moves the item; `onDragEnd`
  // decides dismiss from offset+velocity.

  // Clamp leftward travel to 0 ourselves instead of via dragConstraints. Any `dragConstraints`/`dragElastic`/
  // `dragMomentum` hooks Motion's BUILT-IN release animator, which fires its own settle on `x` at pointer-up
  // and races our handleDragEnd animation on the same value — the item snaps to fully-open for a frame, then
  // our fly-off/unmount runs ("appears fully open, then disappears"). With no constraints, handleDragEnd is
  // the sole animator on release; here we only stop the live drag from pulling the panel past its left edge.
  const handleDrag = (_event: PointerEvent | MouseEvent | TouchEvent, info: PanInfo) => {
    if (info.offset.x < 0) x.set(0)
  }

  const handleDragEnd = (_event: PointerEvent | MouseEvent | TouchEvent, info: PanInfo) => {
    // Dismiss on a clear rightward throw, via the shared swipe decision (same thresholds as the Sheet's
    // grab handle): past 90px OR a fast rightward flick that also cleared the minimum distance. Motion's
    // velocity is px/s; shouldDismissSwipe expects px/ms, so /1000.
    if (shouldDismissSwipe({ dragged: info.offset.x, velocity: info.velocity.x / 1000, limit: 90 })) {
      // CONTINUE the close from the release point: fly the item off the right edge starting at its CURRENT
      // x (carrying the release velocity), then commit the close. `onDragEnd` is the SOLE animator of `x` —
      // we deliberately do NOT use `dragSnapToOrigin`, because that prop fires its own spring-to-origin on
      // every release and races this fly-off, snapping the item back to fully-open for a frame before it
      // leaves (the visible "jump"). The parallax page is coupled to `x`, so it settles into place as the
      // item clears. commitSwipeClose runs the close through the dirty guard and signals the slider (via
      // onSwipeCloseStart) that this close is already animated, so it skips its reverse track and lands at idle.
      //
      // Target = the panel's full width, read LIVE from the element at release (panelRef.offsetWidth). This
      // must never be a stale or zero value: animating `x` toward a target SMALLER than its current value
      // would spring the item leftward back to ~origin (looks "fully open") and complete almost instantly,
      // then unmount — the exact "snap fully open, then immediately disappear" bug. offsetWidth is always
      // the real on-screen width, so the spring always travels rightward off-screen from wherever x is.
      // Fallback x.get() + 1 ensures remaining > 0 for safe duration calculation.
      const target = panelRef.current?.offsetWidth ?? x.get() + 1
      // Fly off with a fixed-duration TWEEN, not a velocity-seeded spring. A spring seeded with the release
      // velocity (px/s — a flick is easily 1500–3000) plus restDelta:1 reaches rest within ~1 frame: the
      // item is effectively gone instantly, reading as "closed with no animation". A duration tween always
      // plays the full rightward travel over a perceptible, release-independent time, so the close visibly
      // continues moving right from wherever the finger lifted. Duration scales mildly with remaining
      // distance so a near-edge release isn't artificially slow.
      const remaining = Math.max(0, target - x.get())
      const duration = target > 0 ? Math.min(0.32, 0.18 + (remaining / target) * 0.16) : 0.18
      animate(x, target, {
        type: 'tween',
        ease: [0.32, 0.72, 0, 1],
        duration,
        onComplete: commitSwipeClose,
      })
      return
    }
    // Below threshold — spring the item back to origin ourselves (no dragSnapToOrigin, see above).
    animate(x, 0, { type: 'spring', stiffness: 500, damping: 40 })
  }

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
      drag={isSettled && !editorFullscreen ? 'x' : false}
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

