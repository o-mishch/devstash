import Link from 'next/link'
import { CalendarRange, PieChart as PieIcon, History, Folder, Pin } from 'lucide-react'
import { getTypeHref } from '@/components/layout/sidebar/utils'
import { DashboardRecentItems } from '@/components/dashboard/dashboard-recent-items'
import { DashboardCollectionsList } from '@/components/dashboard/dashboard-collections-list'
import { DashboardPinnedItems } from '@/components/dashboard/dashboard-pinned-items'
import { AiUsageWidget } from '@/components/dashboard/ai-usage-widget'
import { TotalItemsReveal } from '@/components/dashboard/total-items-reveal'
import {
  MissionControlDonut,
  MissionControlSparkline,
  MissionControlHeatmap,
} from './mission-control/charts-island'
import { SkinWidget } from './skin-widget'
import { SKIN_HEADER_WRAPPER_CLASS } from './skin-header'
import { computeUsage, typeColor, resolveSkinData, type DashboardSkinData } from './shared'

const MC_PANEL = 'relative overflow-hidden rounded-2xl border border-border bg-foreground/[0.02] p-5'

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
      <header className="mb-5">
        <p className="text-sm font-semibold text-primary">Mission control</p>
        <h1 className="mt-1 text-2xl font-extrabold tracking-tight sm:text-3xl">Dashboard</h1>
      </header>

      {/* KPI strip — compact summary. Pro is unlimited, so the dead "Free tier used" tile is dropped
          (the row reflows from 4-up to 3-up); free keeps it. */}
      <div className={`mb-4 grid grid-cols-2 gap-3.5 ${isPro ? 'lg:grid-cols-2' : 'lg:grid-cols-3 [&>*:last-child]:col-span-2 lg:[&>*:last-child]:col-span-1'}`}>
        <div className="rounded-2xl border border-border bg-foreground/[0.02] px-4 py-3">
          <TotalItemsReveal variant="pop">
            <div className="flex items-center justify-between text-xs text-muted-foreground">Total items<span className="text-primary">↑</span></div>
            <div className="mt-1 text-2xl font-extrabold leading-none tracking-[-0.02em]">{stats.totalItems}</div>
          </TotalItemsReveal>
          <MissionControlSparkline activity={activity} />
        </div>
        <KpiCard label="Collections" value={collectionStats.totalCollections} sub={`${collectionStats.favoriteCollections} favorite`} href="/collections" />
        {!isPro && (
          <div className="rounded-2xl border border-border bg-foreground/[0.02] px-4 py-3">
            <div className="flex items-center justify-between text-xs text-muted-foreground">Free tier used<span className="text-violet-400">{`${usage.pct}%`}</span></div>
            <div className="mt-1 text-2xl font-extrabold leading-none">{stats.totalItems}<span className="text-sm font-semibold text-muted-foreground">/{usage.limit}</span></div>
            <div className="mt-2 h-1.5 overflow-hidden rounded-sm bg-foreground/[0.06]">
              <i className="block h-full bg-gradient-to-r from-violet-500 to-primary" style={{ width: `${usage.pct}%` }} />
            </div>
          </div>
        )}
      </div>

      {/* Day-to-day content first — Pinned + Recent + Collections sit above the analytics so the most
          useful data lands above the fold. */}
      {hasPinned && (
        <div className={`${MC_PANEL} mb-4`}>
          <SkinWidget icon={<Pin />} title="Pinned" headerWrapperClassName={SKIN_HEADER_WRAPPER_CLASS['mission-control']}>
            <DashboardPinnedItems initialItems={pinned} />
          </SkinWidget>
        </div>
      )}

      <div className="mb-4 grid items-start gap-4 lg:grid-cols-2 [&>*]:min-w-0">
        <div className={MC_PANEL}>
          <SkinWidget icon={<History />} title="Recent items" headerWrapperClassName={SKIN_HEADER_WRAPPER_CLASS['mission-control']}>
            {hasRecent ? <DashboardRecentItems firstPage={recent} /> : <p className="text-sm text-muted-foreground">No items yet.</p>}
          </SkinWidget>
        </div>
        <div className={MC_PANEL}>
          <SkinWidget icon={<Folder />} title="Collections" count={collectionStats.totalCollections} headerWrapperClassName={SKIN_HEADER_WRAPPER_CLASS['mission-control']}>
            <DashboardCollectionsList collections={collections} />
          </SkinWidget>
        </div>
      </div>

      {/* Insights — the analytics cockpit (activity heatmap + by-type donut) moves below the content;
          it's exploratory data, not the daily task. */}
      <div className="grid items-start gap-4 lg:grid-cols-[1.5fr_1fr] [&>*]:min-w-0">
        <div className={MC_PANEL}>
          <SkinWidget icon={<CalendarRange />} title="Activity · last 12 weeks" headerWrapperClassName={SKIN_HEADER_WRAPPER_CLASS['mission-control']}>
            <MissionControlHeatmap activity={activity} />
          </SkinWidget>
        </div>
        <div className={MC_PANEL}>
          <SkinWidget icon={<PieIcon />} title="By type" headerWrapperClassName={SKIN_HEADER_WRAPPER_CLASS['mission-control']}>
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
          </SkinWidget>
        </div>
      </div>

      {/* AI Usage — demoted to the foot of the dashboard: occasional-reassurance data, below content. */}
      {isPro && (
        <div className={`${MC_PANEL} mt-4`}>
          <AiUsageWidget skin="mission-control" />
        </div>
      )}
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
  const className = 'block rounded-2xl border border-border bg-foreground/[0.02] px-4 py-3'
  const inner = (
    <>
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-xs text-muted-foreground">{label}</span>
        <span className="text-[11px] text-muted-foreground">{sub}</span>
      </div>
      <div className="mt-1 text-2xl font-extrabold leading-none">{value}</div>
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
