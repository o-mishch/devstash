'use client'

import { CSSProperties, ReactNode, useRef, useState, useLayoutEffect } from 'react'
import { motion, type Variants } from 'motion/react'
import { Calendar, FolderOpen, X } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Separator } from '@/components/ui/separator'
import { Skeleton } from '@/components/ui/skeleton'
import { ScrollArea } from '@/components/ui/scroll-area'
import { TooltipProvider } from '@/components/ui/tooltip'
import { ItemIconWrapper } from '@/components/shared/item-icon-wrapper'
import { MobileItemPaneSlider } from '@/components/items/drawer/mobile-item-pane-slider'
import { useEditorFullscreenStore } from '@/stores/editor-fullscreen'
import { useMotionSwipeClose } from '@/hooks/ui/use-motion-swipe-close'
import type { SheetCloseRef } from '@/hooks/ui/use-register-sheet-close'
import { formatDate, cn } from '@/lib/utils'
import { SYSTEM_TYPE_COLORS } from '@/lib/utils/constants'
import type { FullItem, SlimItemType } from '@/types/item'

// Swipe-to-dismiss grip pill — shared dimensions and Motion variants for the touch affordance rendered by
// BOTH drawer shells (the desktop Sheet's drawer-shell and the mobile full-screen views). The shape and
// colour transitions are one source of truth so they can't drift between consumers.
export const SWIPE_GRIP_PILL_CLASS = 'h-14 w-1.5 rounded-full'

// Motion drag variants for the grip pill. The parent panel's `whileDrag="dragging"` propagates to any
// `<motion.* variants={GRIP_VARIANTS}>` child, so the pill highlights while a drag is active — no React state.
export const GRIP_VARIANTS: Variants = {
  idle: { backgroundColor: 'color-mix(in oklch, var(--foreground) 30%, transparent)' },
  dragging: { backgroundColor: 'color-mix(in oklch, var(--primary) 70%, transparent)' },
}

interface MobileFullScreenPanelProps {
  /** Whether the pane is open (drives the swipe hook's spring-back / open guards). */
  open: boolean
  /** True once the open slide finishes and the pane IS the document scroller — enables swipe-to-close. */
  isSettled: boolean
  /** Called synchronously when a swipe has already animated the pane off-screen (slider skips its reverse slide). */
  onSwipeCloseStart?: () => void
  /**
   * Guarded close (routes through the body's dirty guard). The panel calls this on a swipe-dismiss; the body
   * registers its guarded close into this same ref via useRegisterSheetClose. When the ref is empty the swipe
   * falls back to onOpenChange(false).
   */
  sheetCloseRef: SheetCloseRef
  /** Direct (unguarded) close used as the swipe fallback when sheetCloseRef hasn't been populated yet. */
  onOpenChange: (open: boolean) => void
  /**
   * Reset key: when it changes (a different item id) while settled, the document scroll and drag offset
   * snap back to the top so the new item starts at its header. Pass the open item/draft id (or null).
   */
  resetKey: string | null
  /**
   * Extra decoration layered over the always-on `app-dot-grid` texture: 'blobs' adds the live item view's
   * colour blobs; 'none' (draft drawer) keeps just the grid. The grid itself is unconditional — it matches
   * the app shell's background (see (app)/layout.tsx).
   */
  decoration?: 'blobs' | 'none'
  children: ReactNode
}

// The mobile full-screen drag panel. Owns the swipe-right-to-close gesture (Motion drag driven by
// useMotionSwipeClose), the left-edge grip pill, the editor-fullscreen gate, and the on-item-change
// scroll/offset reset. Internal to MobileDrawerHost (the sole consumer); the page-flow body
// (ItemDetailDrawerInner / draft edit content) is passed as `children`, and only the background decoration
// differs between consumers (`decoration`).
function MobileFullScreenPanel({
  open,
  isSettled,
  onSwipeCloseStart,
  sheetCloseRef,
  onOpenChange,
  resetKey,
  decoration = 'blobs',
  children,
}: MobileFullScreenPanelProps) {
  // A maximized editor covers the view and owns its own gestures — disable swipe-to-close while it is up
  // (mirrors DrawerShell) so a horizontal swipe over the editor can't close the view underneath it.
  const editorFullscreen = useEditorFullscreenStore((s) => s.fullscreen)

  // Route a close request through the body's guarded close (sheetCloseRef) so an unsaved edit prompts first;
  // once cleared the body calls onOpenChange(false). Falls back to a direct close when no guard is registered.
  const requestClose = () => {
    const guardedClose = sheetCloseRef.current
    if (guardedClose) guardedClose()
    else onOpenChange(false)
  }

  const { x, panelRef, gripPressed, setGripPressed, dragEnabled, handleDrag, handleDragEnd } = useMotionSwipeClose({
    isOpen: open,
    isSettled,
    editorFullscreen,
    onSwipeCloseStart,
    requestClose,
  })

  // Switching directly from one open item to another (no unmount) — jump back to the top so the new item
  // starts at its header instead of inheriting the previous item's scroll. ONLY in settled mode (signalled
  // by `isSettled`, which the slider passes only when the pane IS the document scroller). During the open
  // SLIDE the pane is a fixed overlay, not the document, so resetting the document scroll there would
  // disturb the kept-mounted page behind it.
  useLayoutEffect(() => {
    if (resetKey === null || !isSettled) return
    // document required: in settled mode the pane IS the page document, so resetting its scroll means the
    // document scroller — there is no React/Next alternative for the document-level scroll position.
    const scroller = document.scrollingElement ?? document.documentElement
    scroller.scrollTop = 0
    // Reset the live drag offset too: switching items mid-drag or mid fly-off (deep-link / programmatic swap)
    // would otherwise leave the new item rendered partially translated by the previous item's `x`.
    x.set(0)
    // x is a stable useMotionValue ref — safe to list since its identity never changes.
  }, [resetKey, isSettled, x])

  return (
    /* Drag wrapper: Motion's drag gesture carries the pane (with its own opaque app background) so a
       rightward drag reveals the page behind it. dragDirectionLock lets vertical gestures fall through to
       document scroll (URL-bar retraction). NO dragConstraints/dragElastic/dragMomentum: each engages
       Motion's built-in release animator, which races our handleDragEnd on the same `x` value — handleDragEnd
       is the SOLE release animator (fly-off or spring-back). Leftward over-drag is clamped in handleDrag.
       min-h-[100lvh] keeps the opaque bg covering the full height. */
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
      {decoration === 'blobs' ? (
        <>
          <div aria-hidden className="pointer-events-none absolute left-1/3 top-0 -z-10 h-[500px] w-[600px] -translate-x-1/2 rounded-full bg-blue-500/[0.08] blur-3xl" />
          <div aria-hidden className="pointer-events-none absolute right-0 top-1/3 -z-10 h-[400px] w-[500px] rounded-full bg-cyan-500/[0.06] blur-3xl" />
        </>
      ) : null}

      {/* Swipe-to-dismiss indicator: a vertical grip pill at the pane's left edge — the touch affordance for
          the rightward swipe-to-close, the same pill the desktop Sheet uses. It lives INSIDE the panel, so it
          rides in WITH the pane during the open slide and travels right with the drag (inherits the panel's
          transform). The OUTER layer is out-of-flow; the INNER sticky column pins the centred pill to the
          SCREEN's vertical middle as the panel scrolls. The `dragging` variant — propagated from the panel's
          whileDrag — highlights it while a drag is active; no React state. */}
      {!editorFullscreen ? (
        <div aria-hidden className="pointer-events-none absolute inset-y-0 left-0 z-[55] w-2">
          <div className="sticky top-0 flex h-[100lvh] flex-col items-start justify-center pl-1">
            <motion.div
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

      {children}
    </motion.div>
  )
}

interface MobileDrawerHostBodyProps {
  isSettled: boolean
  onSwipeCloseStart?: () => void
  /**
   * The body registers its guarded close (dirty-prompt) into this ref via useRegisterSheetClose; the host's
   * MobileFullScreenPanel calls it on a swipe-dismiss so an unsaved edit prompts before closing.
   */
  sheetCloseRef: SheetCloseRef
}

interface MobileDrawerHostProps {
  /** The kept-mounted app page behind the pane (slides left as the pane slides in). */
  page: ReactNode
  open: boolean
  /** Window scroll captured at open, restored when the page becomes the document again on close. */
  openScrollY: number
  /** Extra decoration over the always-on dot-grid — 'blobs' (live item) or 'none' (draft). */
  decoration?: 'blobs' | 'none'
  /** Reset key (open item/draft id, or null) — snaps scroll/offset to top when it changes while settled. */
  resetKey: string | null
  /**
   * Unguarded close (store closeDrawer). Used as the swipe fallback only when the body hasn't registered a
   * guarded close in sheetCloseRef; normally the body drives close itself through the dirty guard.
   */
  onOpenChange: (open: boolean) => void
  /** Renders the pane body (ItemDetailDrawerInner / draft edit content). Returns null while no item is latched. */
  renderBody: (props: MobileDrawerHostBodyProps) => ReactNode
}

// The shared mobile drawer host: MobileItemPaneSlider (page↔pane paired slide + document-scroller handoff)
// wrapping MobileFullScreenPanel (swipe-to-close drag + grip + scroll reset), with the single sheetCloseRef
// the body registers its guarded close into. Both drawer providers (live items, brain-dump drafts) render
// this with their own latched body via `renderBody` — the only thing that differs between them. Extracting
// it removes the slider + panel + close-ref boilerplate both providers used to duplicate verbatim.
export function MobileDrawerHost({ page, open, openScrollY, decoration = 'blobs', resetKey, onOpenChange, renderBody }: MobileDrawerHostProps) {
  // One ref for the host's lifetime, threaded into MobileFullScreenPanel (swipe close) and the body (which
  // registers its dirty-guarded close). Stable across pane swaps — the body re-registers on each mount.
  const sheetCloseRef = useRef<(() => void) | null>(null)

  return (
    <MobileItemPaneSlider
      page={page}
      open={open}
      openScrollY={openScrollY}
      renderPane={({ isSettled, onSwipeCloseStart }) => (
        <MobileFullScreenPanel
          open={open}
          isSettled={isSettled}
          onSwipeCloseStart={onSwipeCloseStart}
          sheetCloseRef={sheetCloseRef}
          onOpenChange={onOpenChange}
          resetKey={resetKey}
          decoration={decoration}
        >
          {renderBody({ isSettled, onSwipeCloseStart, sheetCloseRef })}
        </MobileFullScreenPanel>
      )}
    />
  )
}

interface DrawerContainerProps {
  header: ReactNode
  actions: ReactNode
  children: ReactNode
  style?: CSSProperties
  /**
   * Full-screen mode (mobile): render as document-flow content (NOT a height-capped inner-scroll panel)
   * so the page's <html> document is the scroller. That is the only scroller a mobile browser watches to
   * retract its URL bar; an inner ScrollArea (the default below) never triggers it. Header + action bar
   * stick to the top so they stay reachable as the document scrolls. Used by ItemFullScreenView.
   */
  fullScreen?: boolean
  /**
   * When true, the full-screen header uses `sticky top-0` instead of `fixed inset-x-0 top-0`. Use when
   * the container itself is a `fixed inset-0 overflow-y-auto` overlay (draft drawer's noPage mode) — in
   * that context sticky works correctly and fixed would escape to the viewport and fight app chrome.
   */
  stickyHeader?: boolean
}

function DrawerContainer({ header, actions, children, style, fullScreen = false, stickyHeader = false }: DrawerContainerProps) {
  // Shared header + action-bar chrome. In full-screen mode it sticks to the top of the document; in Sheet
  // mode it is a non-shrinking band above the inner ScrollArea. Only `shrink-0` (irrelevant under sticky)
  // differs, so one tree serves both. @container/actionbar: each button's label span collapses to icon-only
  // one at a time from the right (see actionbarLabelClass) so all buttons fit on one row; flex-nowrap keeps
  // them on a single line.
  const chrome = (
    <>
      <div className="flex shrink-0 items-start gap-3 px-5 pt-5 pb-4 max-sm:px-4 max-sm:pt-2.5 max-sm:pb-1.5">{header}</div>
      <Separator className="shrink-0" />
      <div className="@container/actionbar flex shrink-0 flex-nowrap items-center gap-y-1 gap-x-0.5 px-2 py-1.5 max-sm:py-0.5">{actions}</div>
      <Separator className="shrink-0" />
    </>
  )

  if (fullScreen) {
    return <FullScreenDrawerContainer chrome={chrome} style={style} stickyHeader={stickyHeader}>{children}</FullScreenDrawerContainer>
  }

  return (
    <div className="flex h-full flex-col overflow-hidden" style={style}>
      {chrome}
      {/* ScrollArea (not native overflow) so the drawer scrollbar matches the sidebar's.
          overscroll-behavior:contain stops the locked body from trying to scroll when
          this viewport hits its top/bottom edge (prevents URL-bar flash on iOS). */}
      <ScrollArea className="flex-1 min-h-0 [&_[data-slot=scroll-area-viewport]]:!overflow-x-hidden [&_[data-slot=scroll-area-viewport]]:overscroll-contain">
        <div className="flex flex-col gap-5 px-5 py-4 min-h-full">
          {children}
        </div>
      </ScrollArea>
    </div>
  )
}

interface FullScreenDrawerContainerProps {
  chrome: ReactNode
  children: ReactNode
  style?: CSSProperties
  stickyHeader?: boolean
}

// Mobile full-screen drawer: by default the DOCUMENT is the scroller (so the browser URL bar can retract).
// A plain `position: sticky` header drifts partially out of view on a real mobile browser — the URL-bar
// show/hide scrolls the visual viewport independently of the layout viewport, and the sticky header tracks
// the wrong one (only its lower band stays pinned: the reported partial scroll). `position: fixed` instead
// anchors the header to the visual viewport, so it stays strictly bound to the top exactly like the draft
// drawer's fixed Sheet header. The fixed header lives INSIDE the drag panel, so during a swipe-close it
// inherits the panel's transform (the panel becomes the fixed header's containing block while it is
// transformed) and rides off with the rest of the drawer — no special-casing. A spacer of the measured
// header height holds its place in the document flow so the scrollable content starts right below it.
// `data-drawer-sticky-header` lets the editor overlay's clip-path (editor-chrome) clamp itself below
// the header.
//
// Exception — `stickyHeader`: when the container itself is a `fixed inset-0 overflow-y-auto` overlay (the
// draft drawer's noPage mode), `fixed` would escape to the viewport and fight the app topbar at the same
// z-level. In that mode `sticky top-0` is correct: it stays bound to the scroll container's top, the
// URL-bar drift issue doesn't apply (fixed overlay has its own scroll, not the document), and no spacer
// measurement is needed.
function FullScreenDrawerContainer({ chrome, children, style, stickyHeader = false }: FullScreenDrawerContainerProps) {
  const headerRef = useRef<HTMLDivElement>(null)
  const [headerHeight, setHeaderHeight] = useState(0)

  // Mirror the header's measured height into the spacer so the content never sits under the fixed header.
  // A ResizeObserver catches title wraps, badge changes, and the action bar's responsive label collapse.
  // Only needed in fixed-header mode; sticky mode needs no spacer (the header is in-flow).
  useLayoutEffect(() => {
    if (stickyHeader) return
    const el = headerRef.current
    if (!el) return
    setHeaderHeight(el.offsetHeight)
    const ro = new ResizeObserver(() => setHeaderHeight(el.offsetHeight))
    ro.observe(el)
    return () => ro.disconnect()
  }, [stickyHeader])

  if (stickyHeader) {
    return (
      <div className="relative flex min-h-[100lvh] flex-col bg-popover" style={style}>
        <div data-drawer-sticky-header className="sticky top-0 z-20 bg-popover">
          {chrome}
        </div>
        <div className="flex flex-1 flex-col gap-5 px-5 py-4">{children}</div>
      </div>
    )
  }

  return (
    <div className="relative flex min-h-[100lvh] flex-col bg-popover" style={style}>
      <div ref={headerRef} data-drawer-sticky-header className="fixed inset-x-0 top-0 z-20 bg-popover">
        {chrome}
      </div>
      {/* Spacer reserving the fixed header's height in the document flow so content starts below it. */}
      <div aria-hidden style={{ height: headerHeight }} className="shrink-0" />
      <div className="flex flex-1 flex-col gap-5 px-5 py-4">{children}</div>
    </div>
  )
}

interface DrawerLayoutProps {
  itemType: SlimItemType
  onClose: () => void
  titleArea: ReactNode
  actionArea: ReactNode
  children: ReactNode
  /** Render document-flow full-screen (mobile) instead of the fixed inner-scroll panel. See DrawerContainer. */
  fullScreen?: boolean
  /** See DrawerContainer.stickyHeader. */
  stickyHeader?: boolean
}

export function DrawerLayout({ itemType, onClose, titleArea, actionArea, children, fullScreen = false, stickyHeader = false }: DrawerLayoutProps) {
  return (
    // One TooltipProvider for the whole drawer (delay 150 matches the dense action-bar chrome) — scopes the
    // action bar's Parse tooltip in view mode and the Save/Commit tooltips in edit mode, so neither side
    // needs its own provider.
    <TooltipProvider delay={150}>
      <DrawerContainer
        fullScreen={fullScreen}
        stickyHeader={stickyHeader}
        style={{ '--item-color': SYSTEM_TYPE_COLORS[itemType.name] } as CSSProperties}
        header={
          <>
            <ItemIconWrapper itemType={itemType} wrapperClassName="mt-0.5 size-9 shrink-0 max-sm:size-8" iconClassName="size-4.5" />
            <div className="min-w-0 flex-1">{titleArea}</div>
            <Button variant="ghost" size="icon" className="shrink-0 h-8 w-8 rounded-full bg-muted/50 hover:bg-muted" onClick={onClose} title="Close">
              <X className="size-4" />
            </Button>
          </>
        }
        actions={actionArea}
      >
        {children}
      </DrawerContainer>
    </TooltipProvider>
  )
}

interface DrawerSectionProps {
  label: ReactNode
  icon?: ReactNode
  className?: string
  labelClassName?: string
  children: ReactNode
}

export function DrawerSection({ label, icon, className, labelClassName, children }: DrawerSectionProps) {
  return (
    <section className={cn("shrink-0", className)}>
      <p className={cn("mb-2 flex items-center gap-1.5 text-xs font-medium text-muted-foreground uppercase tracking-wide", labelClassName)}>
        {icon}
        {label}
      </p>
      {children}
    </section>
  )
}

interface DrawerCollectionsSectionProps {
  item: FullItem
  onEdit?: () => void
}

export function DrawerCollectionsSection({ item, onEdit }: DrawerCollectionsSectionProps) {
  return (
    <DrawerSection label="Collections" icon={<FolderOpen className="size-3" />}>
      {item.collections.length > 0 ? (
        <div className="flex flex-wrap gap-1.5">
          {item.collections.map((col) => (
            <Badge key={col.id} variant="outline">{col.name}</Badge>
          ))}
        </div>
      ) : onEdit ? (
        <Button variant="outline" size="sm" className="h-7 text-xs border-dashed text-muted-foreground" onClick={onEdit}>
          Assign collection...
        </Button>
      ) : (
        <p className="text-sm text-muted-foreground">—</p>
      )}
    </DrawerSection>
  )
}

interface DrawerDetailsSectionProps {
  item: FullItem
}

export function DrawerDetailsSection({ item }: DrawerDetailsSectionProps) {
  return (
    <DrawerSection label="Details" icon={<Calendar className="size-3" />}>
      <div className="space-y-1 text-sm">
        <div className="flex justify-between">
          <span className="text-muted-foreground">Created</span>
          <span>{formatDate(item.createdAt)}</span>
        </div>
        <div className="flex justify-between">
          <span className="text-muted-foreground">Updated</span>
          <span>{formatDate(item.updatedAt)}</span>
        </div>
      </div>
    </DrawerSection>
  )
}

export function DrawerCollectionsSkeleton() {
  return (
    <section className="shrink-0">
      <Skeleton className="mb-2 h-3 w-20" />
      <Skeleton className="h-7 w-40 rounded-md" />
    </section>
  )
}

export function DrawerDetailsSkeleton() {
  return (
    <section className="shrink-0">
      <Skeleton className="mb-2 h-3 w-14" />
      <div className="space-y-1.5">
        <div className="flex justify-between">
          <Skeleton className="h-4 w-14" />
          <Skeleton className="h-4 w-20" />
        </div>
        <div className="flex justify-between">
          <Skeleton className="h-4 w-16" />
          <Skeleton className="h-4 w-20" />
        </div>
      </div>
    </section>
  )
}

interface DrawerSkeletonProps {
  fullScreen?: boolean
}

/** Reusable skeleton for drawer-like overlays (item drawer, draft drawer, future modals). */
export function DrawerSkeleton({ fullScreen = false }: DrawerSkeletonProps) {
  return (
    <DrawerContainer
      fullScreen={fullScreen}
      header={
        <>
          <Skeleton className="mt-0.5 size-9 shrink-0 rounded-full" />
          <div className="min-w-0 flex-1 space-y-2">
            <Skeleton className="h-5 w-2/3" />
            <Skeleton className="h-5 w-16 rounded-full" />
          </div>
        </>
      }
      actions={
        <div className="flex items-center gap-0.5 w-full">
          <Skeleton className="h-8 w-20 rounded-md" />
          <Skeleton className="h-8 w-12 rounded-md" />
          <Skeleton className="h-8 w-16 rounded-md" />
          <Skeleton className="h-8 w-14 rounded-md" />
          <Skeleton className="ml-auto h-8 w-8 rounded-md" />
        </div>
      }
    >
      <section className="flex flex-col">
        <Skeleton className="mb-2 h-3 w-16 shrink-0" />
        <Skeleton className="h-[70dvh] min-h-[120px] w-full rounded-md" />
      </section>
      <section className="shrink-0">
        <Skeleton className="mb-2 h-3 w-24" />
        <Skeleton className="h-4 w-2/3" />
      </section>
      <section className="shrink-0">
        <Skeleton className="mb-2 h-3 w-16" />
        <Skeleton className="h-4 w-1/3" />
      </section>
      <section className="shrink-0">
        <Skeleton className="mb-2 h-3 w-10" />
        <div className="flex flex-wrap gap-1.5">
          <Skeleton className="h-6 w-16 rounded-full" />
          <Skeleton className="h-6 w-20 rounded-full" />
          <Skeleton className="h-6 w-14 rounded-full" />
        </div>
      </section>
      <DrawerCollectionsSkeleton />
      <DrawerDetailsSkeleton />
    </DrawerContainer>
  )
}
