import type { CSSProperties, ReactNode } from 'react'
import Link from 'next/link'
import { getTypeHref } from '@/components/layout/sidebar/utils'
import { FREE_TIER_ITEM_LIMIT, SYSTEM_TYPE_COLORS } from '@/lib/utils/constants'
import { cn } from '@/lib/utils'
import type {
  ItemStats,
  ItemTypeDistribution,
  DashboardActivityDay,
  ItemsPage,
  LightItem,
} from '@/types/item'
import type { CollectionWithTypes, CollectionStats } from '@/types/collection'

// All data promises a skin can consume. Every skin reads the same scoped, cached promises — skins
// never open their own data path. `activityPromise` is only provided to the mission-control skin
// (gated in page.tsx), so it is optional.
export interface DashboardSkinData {
  isPro: boolean
  statsPromise: Promise<ItemStats>
  collectionStatsPromise: Promise<CollectionStats>
  collectionsPromise: Promise<CollectionWithTypes[]>
  recentItemsPromise: Promise<ItemsPage>
  pinnedItemsPromise: Promise<LightItem[]>
  typeDistributionPromise: Promise<ItemTypeDistribution[]>
  activityPromise?: Promise<DashboardActivityDay[]>
}

export interface ResolvedSkinData {
  stats: ItemStats
  collectionStats: CollectionStats
  collections: CollectionWithTypes[]
  pinned: LightItem[]
  recent: ItemsPage
  distribution: ItemTypeDistribution[]
  activity: DashboardActivityDay[]
}

// Awaits every data promise a skin can read and returns the resolved bag, so each skin doesn't
// repeat the same Promise.all destructure. All promises are already kicked off (and gated) in
// page.tsx — the ones a skin doesn't render resolve to empty immediately — so awaiting the full set
// uniformly fires no extra queries.
export async function resolveSkinData(data: DashboardSkinData): Promise<ResolvedSkinData> {
  const [stats, collectionStats, collections, pinned, recent, distribution, activity] =
    await Promise.all([
      data.statsPromise,
      data.collectionStatsPromise,
      data.collectionsPromise,
      data.pinnedItemsPromise,
      data.recentItemsPromise,
      data.typeDistributionPromise,
      data.activityPromise ?? Promise.resolve<DashboardActivityDay[]>([]),
    ])
  return { stats, collectionStats, collections, pinned, recent, distribution, activity }
}

export interface SkinUsage {
  totalItems: number
  limit: number
  pct: number
  slotsLeft: number
  isPro: boolean
}

export function computeUsage(totalItems: number, isPro: boolean): SkinUsage {
  const limit = FREE_TIER_ITEM_LIMIT
  const pct = Math.min(100, Math.round((totalItems / limit) * 100))
  return { totalItems, limit, pct, slotsLeft: Math.max(0, limit - totalItems), isPro }
}

export function usageLabel(usage: SkinUsage): string {
  if (usage.isPro) return `${usage.totalItems} items · Pro · unlimited`
  return `${usage.slotsLeft} of ${usage.limit} free slots left`
}

// "Slots left" = how many more items fit under the free-tier cap. Only the free-tier upgrade cards
// surface this stat (Pro skins drop it for the AI Usage section), so the caller is always non-Pro.
export function slotsLeftLabel(usage: SkinUsage): string {
  return String(usage.slotsLeft)
}

export function typeColor(name: string): string {
  return SYSTEM_TYPE_COLORS[name] ?? 'var(--primary)'
}

interface TypeDistributionBarsProps {
  distribution: ItemTypeDistribution[]
  className?: string
}

/** Distribution bars — plain divs (no chart lib). `variant` tweaks density for different skins. */
export function TypeDistributionBars({ distribution, className }: TypeDistributionBarsProps) {
  const max = Math.max(1, ...distribution.map((d) => d.count))
  const visible = distribution.filter((d) => d.count > 0)
  const rows = visible.length > 0 ? visible : distribution.slice(0, 3)
  return (
    <div className={cn('flex flex-col gap-1', className)}>
      {rows.map((d) => (
        <Link
          key={d.name}
          href={getTypeHref(d.name)}
          prefetch={false}
          className="-mx-1.5 flex items-center gap-3 rounded-md px-1.5 py-1 text-xs transition-colors hover:bg-foreground/5"
        >
          <span className="w-16 shrink-0 capitalize text-muted-foreground">{d.name}</span>
          <span className="h-[7px] flex-1 overflow-hidden rounded-full bg-foreground/5">
            <span
              className="block h-full rounded-full"
              style={{ width: `${Math.round((d.count / max) * 100)}%`, background: typeColor(d.name) }}
            />
          </span>
          <span className="w-6 shrink-0 text-right tabular-nums text-muted-foreground">{d.count}</span>
        </Link>
      ))}
    </div>
  )
}

interface TypeDistributionSegmentsProps {
  distribution: ItemTypeDistribution[]
}

/** Segmented single-bar distribution (HUD / neon skins). */
export function TypeDistributionSegments({ distribution }: TypeDistributionSegmentsProps) {
  const visible = distribution.filter((d) => d.count > 0)
  const segments = visible.length > 0 ? visible : distribution.slice(0, 1)
  return (
    <div>
      <div className="mb-3 flex h-7 overflow-hidden rounded-md">
        {segments.map((d) => (
          <span key={d.name} style={{ flexGrow: d.count || 1, background: typeColor(d.name) }} />
        ))}
      </div>
      <div className="flex flex-wrap gap-x-2 gap-y-1">
        {distribution.map((d) => (
          <Link
            key={d.name}
            href={getTypeHref(d.name)}
            prefetch={false}
            className="-mx-1 flex items-center gap-2 rounded-md px-1.5 py-1 text-xs text-muted-foreground transition-colors hover:bg-foreground/5 hover:text-foreground"
          >
            <span className="size-2 rounded-full" style={{ background: typeColor(d.name) }} />
            <span className="capitalize">{d.name}</span>
            <b className="tabular-nums text-foreground">{d.count}</b>
          </Link>
        ))}
      </div>
    </div>
  )
}

interface SkinSectionHeaderProps {
  icon?: ReactNode
  title: string
  count?: number
  action?: ReactNode
  /** When set, the action renders as a real link to this route. */
  actionHref?: string
  className?: string
}

/** Shared uppercase section label used by the non-classic skins. */
export function SkinSectionHeader({ icon, title, count, action, actionHref, className }: SkinSectionHeaderProps) {
  return (
    <div className={cn('mb-3.5 flex items-center gap-2.5 text-[13px] font-bold uppercase tracking-[0.06em] text-muted-foreground', className)}>
      {icon && <span className="inline-flex text-primary [&_svg]:size-[15px]">{icon}</span>}
      {title}
      {typeof count === 'number' && (
        <span className="rounded-full bg-foreground/5 px-2 py-0.5 text-[11px] normal-case tracking-normal">{count}</span>
      )}
      {action && actionHref && (
        <Link href={actionHref} prefetch={false} className="ml-auto text-xs font-medium normal-case tracking-normal text-primary hover:underline">
          {action}
        </Link>
      )}
    </div>
  )
}

export function withItemColor(name: string): CSSProperties {
  return { '--item-color': typeColor(name) } as CSSProperties
}
