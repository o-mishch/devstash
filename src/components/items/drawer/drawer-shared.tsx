import { CSSProperties, ReactNode } from 'react'
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

interface DrawerContainerProps {
  header: ReactNode
  actions: ReactNode
  children: ReactNode
  style?: CSSProperties
}

function DrawerContainer({ header, actions, children, style }: DrawerContainerProps) {
  return (
    <div className="flex h-full flex-col overflow-hidden" style={style}>
      <div className="flex shrink-0 items-start gap-3 px-5 pt-5 pb-4 max-sm:px-4 max-sm:pt-2.5 max-sm:pb-1.5">{header}</div>
      <Separator className="shrink-0" />
      {/* @container/actionbar: as this row narrows, each button's label span collapses to icon-only
          one at a time from the right (see actionbarLabelClass) so all buttons fit on one row without
          wrapping. flex-nowrap keeps them in a single line always. */}
      <div className="@container/actionbar flex shrink-0 flex-nowrap items-center gap-y-1 gap-x-0.5 px-2 py-1.5 max-sm:py-0.5">{actions}</div>
      <Separator className="shrink-0" />
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

interface DrawerLayoutProps {
  itemType: SlimItemType
  onClose: () => void
  titleArea: ReactNode
  actionArea: ReactNode
  children: ReactNode
}

export function DrawerLayout({ itemType, onClose, titleArea, actionArea, children }: DrawerLayoutProps) {
  return (
    // One TooltipProvider for the whole drawer (delay 150 matches the dense action-bar chrome) — scopes the
    // action bar's Parse tooltip in view mode and the Save/Commit tooltips in edit mode, so neither side
    // needs its own provider.
    <TooltipProvider delay={150}>
      <DrawerContainer
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
          {item.collections.map((col: { id: string; name: string }) => (
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

export function DrawerSkeleton() {
  return (
    <DrawerContainer
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
