import type { ReactNode } from 'react'
import type { LucideIcon } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { ChevronDown, Folder, History, Pin } from 'lucide-react'
import { CollectionCardSkeleton } from '@/components/shared/skeletons'
import { cn } from '@/lib/utils'
import { STAT_CHIP_BASE } from './stat-chip'
import { statsCardsGridClass } from './stats-cards'

interface SkeletonCardHeaderProps {
  icon: LucideIcon
  title: string
  headerAction?: ReactNode
}

function SkeletonCardHeader({ icon: Icon, title, headerAction }: SkeletonCardHeaderProps) {
  return (
    <CardHeader className="pb-3">
      <div className="flex w-full items-center justify-between">
        <CardTitle className="flex items-center gap-1.5 text-sm font-semibold">
          <Icon className="size-3.5 text-primary" />
          {title}
          <ChevronDown className="size-3.5 text-muted-foreground" />
        </CardTitle>
        {headerAction}
      </div>
    </CardHeader>
  )
}

export function CollectionsGridSkeleton() {
  return (
    <Card className="overflow-visible bg-[var(--muted,var(--background))] border-l-2 border-l-accent">
      <SkeletonCardHeader
        icon={Folder}
        title="Collections"
        headerAction={<Skeleton className="h-4 w-12" />}
      />
      <CardContent className="overflow-visible pt-0">
        <div className="app-grid card-grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
          {[...Array(6)].map((_, i) => (
            <CollectionCardSkeleton key={i} />
          ))}
        </div>
      </CardContent>
    </Card>
  )
}

function DashboardListSkeleton({ count = 3 }: { count?: number }) {
  return (
    <div className="flex flex-col gap-3">
      {[...Array(count)].map((_, i) => (
        <div key={i} className="app-row h-[56px] gap-3 rounded-xl border-l-2 border-l-muted/20 bg-card px-2 ring-1 ring-border">
          <Skeleton className="size-7 shrink-0 rounded-md" />
          <div className="min-w-0 flex-1 space-y-1.5">
            <Skeleton className="h-4 w-40" />
            <Skeleton className="h-3 w-64" />
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <Skeleton className="hidden h-5 w-12 rounded-full sm:block" />
            <Skeleton className="h-3 w-12" />
          </div>
        </div>
      ))}
    </div>
  )
}

interface DashboardWidgetListSkeletonProps {
  icon: LucideIcon
  title: string
  count: number
}

function DashboardWidgetListSkeleton({ icon, title, count }: DashboardWidgetListSkeletonProps) {
  return (
    <Card className="bg-[var(--muted,var(--background))] border-l-2 border-l-accent">
      <SkeletonCardHeader icon={icon} title={title} />
      <CardContent>
        <DashboardListSkeleton count={count} />
      </CardContent>
    </Card>
  )
}

// The loaded Pinned/Recent widgets tint their left border with the dominant item-type color, which
// can't be known before the data arrives — so the skeleton intentionally uses the neutral `accent`
// border. The hue settles once content loads; the 2px gutter width matches so only the color resolves.
export function PinnedSkeleton() {
  return <DashboardWidgetListSkeleton icon={Pin} title="Pinned" count={5} />
}

export function RecentItemsSkeleton() {
  return <DashboardWidgetListSkeleton icon={History} title="Recent Items" count={7} />
}

interface StatsCardsSkeletonProps {
  // Pro renders 3 stat chips + a wide (col-span-2) Brain Dump placeholder in a 5-col track; free keeps
  // the plain 4-up of chips — mirrors StatsCards exactly so the Suspense swap doesn't shift layout.
  isPro: boolean
}

export function StatsCardsSkeleton({ isPro }: StatsCardsSkeletonProps) {
  const chipCount = isPro ? 3 : 4

  return (
    <div className={statsCardsGridClass(isPro)}>
      {[...Array(chipCount)].map((_, i) => (
        // Index 2 is the Favorite Items chip — hidden on mobile to mirror StatsCards.
        <div key={i} className={cn(STAT_CHIP_BASE, i === 2 && 'max-sm:hidden')}>
          <Skeleton className="size-8 shrink-0 rounded-lg" />
          {/* Bars kept shorter than the icon so it governs the chip height — exactly as the loaded
           * StatChipBody does. flex-1 + max-w so the label never overflows on mobile. */}
          <div className="min-w-0 flex-1">
            <Skeleton className="h-4 w-10 rounded" />
            <Skeleton className="mt-1 h-3 w-full max-w-24 rounded" />
          </div>
        </div>
      ))}
      {isPro && (
        // Mirrors the loaded Brain Dump cell: two stacked rows (identity, then meter + CTA).
        // Row heights are measured from the live widget: row1=50px (badge makes it tall), row2=37px
        // (PopoverTrigger py-1 + content). py-[18.75px]*2 + 50 + gap-2.5(10) + 37 = 139px = loaded height.
        <div className={cn(STAT_CHIP_BASE, 'col-span-2 flex-col items-stretch justify-center gap-2.5 !py-[18.75px]')}>
          <div className="flex h-[50px] items-center gap-2.5">
            <Skeleton className="size-8 shrink-0 rounded-[10px]" />
            <Skeleton className="h-4 w-24 rounded" />
            <Skeleton className="h-3 w-40 rounded max-lg:hidden" />
          </div>
          <div className="flex h-[37px] items-center gap-3">
            <Skeleton className="h-2 flex-1 rounded-full" />
            <Skeleton className="size-7 shrink-0 rounded-lg" />
          </div>
        </div>
      )}
    </div>
  )
}
