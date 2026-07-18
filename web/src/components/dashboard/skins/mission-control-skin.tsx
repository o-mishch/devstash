import type { ReactNode } from 'react'
import { Link } from '@tanstack/react-router'
import { CalendarRange, Folder, History, PieChart as PieIcon, Pin } from 'lucide-react'
import type { DashboardData } from '@/hooks/use-dashboard'
import { useActivity } from '@/hooks/use-activity'
import {
  DashboardPinnedItems,
  DashboardRecentItems,
} from '@/components/dashboard/dashboard-item-lists'
import { DashboardCollectionsList } from '@/components/dashboard/dashboard-collections-list'
import { AiUsageWidget } from '@/components/dashboard/ai-usage-widget'
import { BrainDumpWidget } from '@/components/dashboard/brain-dump-widget'
import { TotalItemsReveal } from '@/components/dashboard/total-items-reveal'
import {
  MissionControlDonut,
  MissionControlHeatmap,
  MissionControlSparkline,
} from './mission-control/charts-island'
import { SkinWidget } from './skin-widget'
import { computeUsage, statGridColsClass, typeColor, TypeLink } from './shared'

const MC_PANEL =
  'relative overflow-hidden rounded-2xl border border-border bg-foreground/[0.02] p-5 transition-colors duration-300 hover:bg-foreground/[0.04]'

// Mission Control (Pro) — analytics cockpit: activity heatmap, by-type donut, KPI sparkline. The
// only skin that consumes the activity series (fetched by `useActivity`, not the shared dashboard data).
export function MissionControlSkin({
  isPro,
  totalItems,
  totalCollections,
  favoriteCollections,
  distribution,
  collections,
  pinned,
  recent,
}: DashboardData): ReactNode {
  const activityQuery = useActivity()
  const activity = activityQuery.data?.days ?? []
  const usage = computeUsage(totalItems, isPro)
  const hasRecent = recent.length > 0
  const hasPinned = pinned.length > 0
  const legend = distribution.filter((d) => d.count > 0)

  return (
    <div>
      <header className="mb-5">
        <p className="text-sm font-semibold text-primary">Mission control</p>
        <h1 className="mt-1 text-2xl font-extrabold tracking-tight sm:text-3xl">Dashboard</h1>
      </header>

      <div
        className={`mb-4 grid grid-cols-2 gap-3.5 ${statGridColsClass(isPro)}`}
      >
        <div className="rounded-2xl border border-border bg-foreground/[0.02] px-4 py-3">
          <TotalItemsReveal variant="pop">
            <div className="flex items-center justify-between text-xs text-muted-foreground">
              Total items<span className="text-primary">↑</span>
            </div>
            <div className="mt-1 text-2xl font-extrabold leading-none tracking-[-0.02em]">
              {totalItems}
            </div>
          </TotalItemsReveal>
          <MissionControlSparkline activity={activity} />
        </div>
        <Link
          to="/collections"
          className="block rounded-2xl border border-border bg-foreground/[0.02] px-4 py-3 transition-colors hover:bg-foreground/5"
        >
          <div className="flex items-baseline justify-between gap-2">
            <span className="text-xs text-muted-foreground">Collections</span>
            <span className="text-[11px] text-muted-foreground">
              {favoriteCollections} favorite
            </span>
          </div>
          <div className="mt-1 text-2xl font-extrabold leading-none">{totalCollections}</div>
        </Link>
        {isPro && <BrainDumpWidget className="col-span-2" />}
        {!isPro && (
          <div className="rounded-2xl border border-border bg-foreground/[0.02] px-4 py-3">
            <div className="flex items-center justify-between text-xs text-muted-foreground">
              Free tier used<span className="text-violet-400">{`${usage.pct}%`}</span>
            </div>
            <div className="mt-1 text-2xl font-extrabold leading-none">
              {totalItems}
              <span className="text-sm font-semibold text-muted-foreground">/{usage.limit}</span>
            </div>
            <div className="mt-2 h-1.5 overflow-hidden rounded-sm bg-foreground/[0.06]">
              <i
                className="block h-full w-[var(--ds-bar-pct)] bg-gradient-to-r from-violet-500 to-primary"
                // oxlint-disable-next-line react/forbid-dom-props -- dynamic CSS custom property (usage bar)
                style={{ '--ds-bar-pct': `${usage.pct}%` }}
              />
            </div>
          </div>
        )}
      </div>

      {hasPinned && (
        <div className={`${MC_PANEL} mb-4`}>
          <SkinWidget icon={<Pin />} title="Pinned" skin="mission-control">
            <DashboardPinnedItems items={pinned} />
          </SkinWidget>
        </div>
      )}

      <div className="mb-4 grid items-start gap-4 lg:grid-cols-2 [&>*]:min-w-0">
        <div className={MC_PANEL}>
          <SkinWidget icon={<History />} title="Recent items" skin="mission-control">
            {hasRecent ? (
              <DashboardRecentItems items={recent} />
            ) : (
              <p className="text-sm text-muted-foreground">No items yet.</p>
            )}
          </SkinWidget>
        </div>
        <div className={MC_PANEL}>
          <SkinWidget
            icon={<Folder />}
            title="Collections"
            count={totalCollections}
            skin="mission-control"
          >
            <DashboardCollectionsList collections={collections} />
          </SkinWidget>
        </div>
      </div>

      <div className="grid items-start gap-4 lg:grid-cols-[1.5fr_1fr] [&>*]:min-w-0">
        <div className={MC_PANEL}>
          <SkinWidget
            icon={<CalendarRange />}
            title="Activity · last 12 weeks"
            skin="mission-control"
          >
            <MissionControlHeatmap activity={activity} />
          </SkinWidget>
        </div>
        <div className={MC_PANEL}>
          <SkinWidget icon={<PieIcon />} title="By type" skin="mission-control">
            <MissionControlDonut distribution={distribution} />
            <div className="mt-4 flex flex-col gap-0.5">
              {legend.map((d) => (
                <TypeLink
                  key={d.name}
                  name={d.name}
                  className="-mx-2 flex items-center gap-2 rounded-md px-2 py-1 text-[12.5px] text-muted-foreground transition-colors hover:bg-foreground/5 hover:text-foreground"
                >
                  <span
                    className="size-2 rounded-full bg-[var(--ds-dot-color)]"
                    // oxlint-disable-next-line react/forbid-dom-props -- dynamic CSS custom property (legend dot color)
                    style={{ '--ds-dot-color': typeColor(d.name) }}
                  />
                  <span className="capitalize">{d.name}</span>
                  <b className="ml-auto tabular-nums text-foreground">{d.count}</b>
                </TypeLink>
              ))}
            </div>
          </SkinWidget>
        </div>
      </div>

      {isPro && (
        <div className={`${MC_PANEL} mt-4`}>
          <AiUsageWidget skin="mission-control" />
        </div>
      )}
    </div>
  )
}
