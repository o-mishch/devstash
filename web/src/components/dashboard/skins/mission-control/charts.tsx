import { useMemo } from 'react'
import type { ReactNode } from 'react'
import { Area, AreaChart, Pie, PieChart, ResponsiveContainer } from 'recharts'
import { ActivityCalendar } from 'react-activity-calendar'
import type { ActivityDay, ItemTypeCount } from '@/client'
import { typeColor } from '@/lib/type-colors'

// Chart widgets for the Mission Control skin. Lazy-loaded via charts-island.tsx so Recharts +
// react-activity-calendar never ship on the default/classic dashboard path. Donut + sparkline use
// Recharts; the contribution heatmap uses react-activity-calendar (its purpose-built lib) — the same
// heatmap the legacy app used.

interface MissionControlDonutProps {
  distribution: ItemTypeCount[]
}

interface ActivityChartProps {
  activity: ActivityDay[]
}

/** By-type donut (Recharts PieChart) with the total in the center. Starts at 12 o'clock, clockwise. */
export function MissionControlDonut({ distribution }: MissionControlDonutProps): ReactNode {
  // Each datum carries its own `fill` so the Pie colors segments per-type without the deprecated
  // <Cell> children API.
  const data = useMemo(
    () =>
      distribution
        .filter((d) => d.count > 0)
        .map((d) => ({ name: d.name, count: d.count, fill: typeColor(d.name) })),
    [distribution],
  )
  const total = data.reduce((sum, d) => sum + d.count, 0)

  if (total === 0) {
    return (
      <div className="grid h-[150px] place-items-center text-sm text-muted-foreground">
        No items yet
      </div>
    )
  }

  return (
    <div className="relative mx-auto h-[150px] w-[150px]">
      <PieChart width={150} height={150}>
        <Pie
          data={data}
          dataKey="count"
          nameKey="name"
          cx="50%"
          cy="50%"
          innerRadius={54}
          outerRadius={74}
          paddingAngle={data.length > 1 ? 2 : 0}
          startAngle={90}
          endAngle={-270}
          stroke="none"
        />
      </PieChart>
      <div className="pointer-events-none absolute inset-0 grid place-items-center text-center">
        <div>
          <b className="block text-2xl font-extrabold">{total}</b>
          <span className="text-[11px] text-muted-foreground">items</span>
        </div>
      </div>
    </div>
  )
}

/** KPI sparkline of the last 21 days' item counts (Recharts area). */
export function MissionControlSparkline({ activity }: ActivityChartProps): ReactNode {
  const data = useMemo(() => activity.slice(-21), [activity])
  if (data.length === 0) return <div className="h-[28px] w-full" />

  return (
    <div className="mt-2 h-[28px] w-full">
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={data} margin={{ top: 2, right: 0, bottom: 0, left: 0 }}>
          <Area
            type="monotone"
            dataKey="count"
            stroke="var(--primary)"
            strokeWidth={2}
            fill="var(--primary)"
            fillOpacity={0.12}
            isAnimationActive={false}
            dot={false}
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  )
}

// Explicit hex scales (5 = maxLevel + 1). react-activity-calendar parses these internally, so CSS
// variables can't be used — concrete colors in the brand-blue ramp, hoisted to module scope.
const HEATMAP_THEME = {
  light: ['#eceef2', '#bfdbfe', '#60a5fa', '#3b82f6', '#1d4ed8'],
  dark: ['#1b1e29', '#27407a', '#3b62c4', '#4f7cff', '#7aa2ff'],
}
const HEATMAP_LABELS = { totalCount: '{{count}} items in the last 12 weeks' }

/** 12-week contribution heatmap (react-activity-calendar). Guards the empty case the lib throws on. */
export function MissionControlHeatmap({ activity }: ActivityChartProps): ReactNode {
  // Empty is a real state (a user with no recent activity), not a loading state — render a plain
  // spacer, never the animate-pulse skeleton, which would falsely read as "still loading".
  if (activity.length === 0) return <div className="h-[120px] w-full" />

  return (
    <ActivityCalendar
      data={activity}
      blockSize={11}
      blockMargin={4}
      showTotalCount={false}
      showColorLegend
      maxLevel={4}
      theme={HEATMAP_THEME}
      labels={HEATMAP_LABELS}
    />
  )
}
