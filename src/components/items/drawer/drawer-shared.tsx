'use client'

import { CSSProperties, ReactNode, useRef, useState, useLayoutEffect } from 'react'
import { type Variants } from 'motion/react'
import { Calendar, FolderOpen, X } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Separator } from '@/components/ui/separator'
import { Skeleton } from '@/components/ui/skeleton'
import { ScrollArea } from '@/components/ui/scroll-area'
import { TooltipProvider } from '@/components/ui/tooltip'
import { ItemIconWrapper } from '@/components/shared/item-icon-wrapper'
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
}

function DrawerContainer({ header, actions, children, style, fullScreen = false }: DrawerContainerProps) {
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
    return <FullScreenDrawerContainer chrome={chrome} style={style}>{children}</FullScreenDrawerContainer>
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
}

// Mobile full-screen drawer: the DOCUMENT is the scroller (so the browser URL bar can retract). A plain
// `position: sticky` header drifts partially out of view on a real mobile browser — the URL-bar show/hide
// scrolls the visual viewport independently of the layout viewport, and the sticky header tracks the wrong
// one (only its lower band stays pinned: the reported partial scroll). `position: fixed` instead anchors
// the header to the visual viewport, so it stays strictly bound to the top exactly like the draft drawer's
// fixed Sheet header. The fixed header lives INSIDE the drag panel, so during a swipe-close it inherits the
// panel's transform (the panel becomes the fixed header's containing block while it is transformed) and
// rides off with the rest of the drawer — no special-casing. A spacer of the measured header height holds
// its place in the document flow so the scrollable content starts right below it. `data-drawer-sticky-header`
// lets the editor overlay's clip-path (editor-chrome) clamp itself below the header.
function FullScreenDrawerContainer({ chrome, children, style }: FullScreenDrawerContainerProps) {
  const headerRef = useRef<HTMLDivElement>(null)
  const [headerHeight, setHeaderHeight] = useState(0)

  // Mirror the header's measured height into the spacer so the content never sits under the fixed header.
  // A ResizeObserver catches title wraps, badge changes, and the action bar's responsive label collapse.
  useLayoutEffect(() => {
    const el = headerRef.current
    if (!el) return
    setHeaderHeight(el.offsetHeight)
    const ro = new ResizeObserver(() => setHeaderHeight(el.offsetHeight))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

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
}

export function DrawerLayout({ itemType, onClose, titleArea, actionArea, children, fullScreen = false }: DrawerLayoutProps) {
  return (
    // One TooltipProvider for the whole drawer (delay 150 matches the dense action-bar chrome) — scopes the
    // action bar's Parse tooltip in view mode and the Save/Commit tooltips in edit mode, so neither side
    // needs its own provider.
    <TooltipProvider delay={150}>
      <DrawerContainer
        fullScreen={fullScreen}
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
