import Link from 'next/link'
import { CalendarRange, PieChart as PieIcon, History, Folder, Pin } from 'lucide-react'
import { getTypeHref } from '@/components/layout/sidebar/utils'
import { DashboardRecentItems } from '@/components/dashboard/dashboard-recent-items'
import { DashboardCollectionsList } from '@/components/dashboard/dashboard-collections-list'
import { DashboardPinnedItems } from '@/components/dashboard/dashboard-pinned-items'
import { TotalItemsReveal } from '@/components/dashboard/total-items-reveal'
import {
  MissionControlDonut,
  MissionControlSparkline,
  MissionControlHeatmap,
} from './mission-control/charts-island'
import { SkinCollapsibleSection } from './skin-collapsible-section'
import { computeUsage, typeColor, resolveSkinData, type DashboardSkinData } from './shared'

const MC_PANEL = 'rounded-2xl border border-border bg-foreground/[0.02] p-5'

// Mission Control (Pro) — analytics cockpit: activity heatmap, by-type donut, KPI sparklines.
// The only skin that consumes the activity series (fetched conditionally in page.tsx).
export async function MissionControlSkin(data: DashboardSkinData) {
  const { isPro } = data
  const { stats, collectionStats, collections, pinned, recent, distribution, activity } =
    await resolveSkinData(data)
  const usage = computeUsage(stats.totalItems, isPro)
  const hasRecent = recent.items.length > 0
  const hasPinned = pinned.length > 0
  const legend = distribution.filter((d) => d.count > 0)

  return (
    <div>
      <header className="mb-6">
        <p className="text-sm font-semibold text-primary">Mission control</p>
        <h1 className="mt-1 text-2xl font-extrabold tracking-tight sm:text-3xl">Dashboard</h1>
        <p className="mt-1 text-sm text-muted-foreground">Your developer knowledge hub</p>
      </header>

      <div className="mb-4 grid grid-cols-2 gap-3.5 lg:grid-cols-4">
        <div className="rounded-2xl border border-border bg-foreground/[0.02] p-4">
          <TotalItemsReveal variant="pop">
            <div className="flex items-center justify-between text-xs text-muted-foreground">Total items<span className="text-primary">↑</span></div>
            <div className="my-1.5 text-3xl font-extrabold tracking-[-0.02em]">{stats.totalItems}</div>
          </TotalItemsReveal>
          <MissionControlSparkline activity={activity} />
        </div>
        <KpiCard label="Collections" value={collectionStats.totalCollections} sub={`${collectionStats.favoriteCollections} favorite`} href="/collections" />
        <KpiCard label="Favorites" value={stats.favoriteItems} sub={`of ${stats.totalItems} items`} href="/favorites" />
        <div className="rounded-2xl border border-border bg-foreground/[0.02] p-4">
          <div className="flex items-center justify-between text-xs text-muted-foreground">Free tier used<span className="text-violet-400">{usage.isPro ? 'Pro' : `${usage.pct}%`}</span></div>
          <div className="my-1.5 text-3xl font-extrabold">{stats.totalItems}<span className="text-base font-semibold text-muted-foreground">/{usage.limit}</span></div>
          <div className="mt-2.5 h-1.5 overflow-hidden rounded-sm bg-foreground/[0.06]">
            <i className="block h-full bg-gradient-to-r from-violet-500 to-primary" style={{ width: `${usage.isPro ? 100 : usage.pct}%` }} />
          </div>
        </div>
      </div>

      <div className="mb-4 grid items-start gap-4 lg:grid-cols-[1.5fr_1fr] [&>*]:min-w-0">
        <div className={MC_PANEL}>
          <SkinCollapsibleSection icon={<CalendarRange />} title="Activity · last 12 weeks">
            <MissionControlHeatmap activity={activity} />
          </SkinCollapsibleSection>
        </div>
        <div className={MC_PANEL}>
          <SkinCollapsibleSection icon={<PieIcon />} title="By type">
            <MissionControlDonut distribution={distribution} />
            <div className="mt-4 flex flex-col gap-0.5">
              {legend.map((d) => (
                <Link
                  key={d.name}
                  href={getTypeHref(d.name)}
                  prefetch={false}
                  className="-mx-2 flex items-center gap-2 rounded-md px-2 py-1 text-[12.5px] text-muted-foreground transition-colors hover:bg-foreground/5 hover:text-foreground"
                >
                  <span className="size-2 rounded-full" style={{ background: typeColor(d.name) }} />
                  <span className="capitalize">{d.name}</span>
                  <b className="ml-auto tabular-nums text-foreground">{d.count}</b>
                </Link>
              ))}
            </div>
          </SkinCollapsibleSection>
        </div>
      </div>

      {hasPinned && (
        <div className={`${MC_PANEL} mb-4`}>
          <SkinCollapsibleSection icon={<Pin />} title="Pinned">
            <DashboardPinnedItems initialItems={pinned} />
          </SkinCollapsibleSection>
        </div>
      )}

      <div className="grid items-start gap-4 lg:grid-cols-2 [&>*]:min-w-0">
        <div className={MC_PANEL}>
          <SkinCollapsibleSection icon={<History />} title="Recent items">
            {hasRecent ? <DashboardRecentItems firstPage={recent} /> : <p className="text-sm text-muted-foreground">No items yet.</p>}
          </SkinCollapsibleSection>
        </div>
        <div className={MC_PANEL}>
          <SkinCollapsibleSection icon={<Folder />} title="Collections" count={collectionStats.totalCollections}>
            <DashboardCollectionsList collections={collections} />
          </SkinCollapsibleSection>
        </div>
      </div>
    </div>
  )
}

interface KpiCardProps {
  label: string
  value: number
  sub: string
  href?: string
}

function KpiCard({ label, value, sub, href }: KpiCardProps) {
  const className = 'block rounded-2xl border border-border bg-foreground/[0.02] p-4'
  const inner = (
    <>
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="my-1.5 text-3xl font-extrabold">{value}</div>
      <div className="text-[11px] text-muted-foreground">{sub}</div>
    </>
  )
  if (href) {
    return (
      <Link href={href} prefetch={false} className={`${className} transition-colors hover:bg-foreground/5`}>
        {inner}
      </Link>
    )
  }
  return <div className={className}>{inner}</div>
}
