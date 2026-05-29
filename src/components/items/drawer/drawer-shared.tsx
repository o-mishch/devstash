import { CSSProperties, ReactNode } from 'react'
import { Calendar, FolderOpen, X } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Separator } from '@/components/ui/separator'
import { Skeleton } from '@/components/ui/skeleton'
import { ItemIconWrapper } from '@/components/shared/item-icon-wrapper'
import { formatDate, cn } from '@/lib/utils'
import type { Item } from '@/types/item'

interface DrawerContainerProps {
  header: ReactNode
  actions: ReactNode
  children: ReactNode
  style?: CSSProperties
}

function DrawerContainer({ header, actions, children, style }: DrawerContainerProps) {
  return (
    <div className="flex h-full flex-col overflow-hidden" style={style}>
      <div className="flex items-start gap-3 px-5 pt-5 pb-4">{header}</div>
      <Separator />
      <div className="flex items-center gap-0.5 px-2 py-1.5">{actions}</div>
      <Separator />
      <div className="flex-1 min-h-0 flex flex-col gap-5 px-5 py-4 overflow-hidden">
        {children}
      </div>
    </div>
  )
}

interface DrawerLayoutProps {
  itemType: Item['itemType']
  onClose: () => void
  titleArea: ReactNode
  actionArea: ReactNode
  children: ReactNode
}

export function DrawerLayout({ itemType, onClose, titleArea, actionArea, children }: DrawerLayoutProps) {
  return (
    <DrawerContainer
      style={{ '--item-color': itemType.color } as CSSProperties}
      header={
        <>
          <ItemIconWrapper itemType={itemType} wrapperClassName="mt-0.5 size-9 shrink-0" iconClassName="size-4.5" />
          <div className="min-w-0 flex-1">{titleArea}</div>
          <Button variant="ghost" size="icon-sm" className="shrink-0" onClick={onClose}>
            <X className="size-4" />
          </Button>
        </>
      }
      actions={actionArea}
    >
      {children}
    </DrawerContainer>
  )
}

interface SectionLabelProps {
  children: ReactNode
  icon?: ReactNode
}

function SectionLabel({ children, icon }: SectionLabelProps) {
  return (
    <p className="mb-2 flex items-center gap-1.5 text-xs font-medium text-muted-foreground uppercase tracking-wide">
      {icon}
      {children}
    </p>
  )
}

interface DrawerSectionProps {
  label: ReactNode
  icon?: ReactNode
  className?: string
  children: ReactNode
}

export function DrawerSection({ label, icon, className, children }: DrawerSectionProps) {
  return (
    <section className={cn("shrink-0", className)}>
      <SectionLabel icon={icon}>{label}</SectionLabel>
      {children}
    </section>
  )
}

interface DrawerSharedSectionsProps {
  item: Item
}

export function DrawerSharedSections({ item }: DrawerSharedSectionsProps) {
  let collectionsContent: ReactNode
  if (item.collections.length > 0) {
    collectionsContent = (
      <div className="flex flex-wrap gap-1.5">
        {item.collections.map((col) => (
          <Badge key={col.id} variant="outline">{col.name}</Badge>
        ))}
      </div>
    )
  } else {
    collectionsContent = <p className="text-sm text-muted-foreground">—</p>
  }

  return (
    <>
      <DrawerSection label="Collections" icon={<FolderOpen className="size-3" />}>
        {collectionsContent}
      </DrawerSection>

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
    </>
  )
}

export function DrawerSkeleton() {
  return (
    <DrawerContainer
      header={
        <>
          <Skeleton className="mt-0.5 size-9 shrink-0 rounded-full" />
          <div className="flex-1 space-y-2">
            <Skeleton className="h-5 w-2/3" />
            <Skeleton className="h-4 w-1/4" />
          </div>
        </>
      }
      actions={
        <div className="flex items-center gap-1 w-full">
          <Skeleton className="h-8 w-24" />
          <Skeleton className="h-8 w-16" />
          <Skeleton className="h-8 w-16" />
          <Skeleton className="h-8 w-16" />
          <Skeleton className="ml-auto h-8 w-8" />
        </div>
      }
    >
      <div className="flex flex-1 min-h-0 flex-col space-y-2">
        <Skeleton className="h-3 w-16 shrink-0" />
        <Skeleton className="flex-1 min-h-0 w-full rounded-md" />
      </div>
      <div className="shrink-0 space-y-2">
        <Skeleton className="h-3 w-24" />
        <Skeleton className="h-4 w-full" />
        <Skeleton className="h-4 w-3/4" />
      </div>
      <div className="shrink-0 space-y-2">
        <Skeleton className="h-3 w-12" />
        <div className="flex gap-1.5">
          <Skeleton className="h-6 w-14" />
          <Skeleton className="h-6 w-14" />
        </div>
      </div>
    </DrawerContainer>
  )
}
