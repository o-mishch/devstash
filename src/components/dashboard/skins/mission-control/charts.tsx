'use client'

import { useMemo } from 'react'
import { ActivityCalendar } from 'react-activity-calendar'
import { Area, AreaChart, Cell, Pie, PieChart, ResponsiveContainer } from 'recharts'
import { SYSTEM_TYPE_COLORS } from '@/lib/utils/constants'
import type { ItemTypeDistribution, DashboardActivityDay } from '@/types/item'

// Heavy chart widgets for the mission-control skin. Lazy-loaded (ssr:false) from charts-island.tsx
// so Recharts + react-activity-calendar never ship on the default/classic dashboard path.

interface MissionControlDonutProps {
  distribution: ItemTypeDistribution[]
}

interface ActivityChartProps {
  activity: DashboardActivityDay[]
}

export function MissionControlDonut({ distribution }: MissionControlDonutProps) {
  const data = useMemo(() => distribution.filter((d) => d.count > 0), [distribution])
  const total = data.reduce((sum, d) => sum + d.count, 0)

  if (total === 0) {
    return <div className="grid h-[150px] place-items-center text-sm text-muted-foreground">No items yet</div>
  }

  return (
    <div className="relative mx-auto h-[150px] w-[150px]">
      <ResponsiveContainer width="100%" height="100%">
        <PieChart>
          <Pie data={data} dataKey="count" nameKey="name" innerRadius={54} outerRadius={74} paddingAngle={2} strokeWidth={0}>
            {data.map((d) => (
              <Cell key={d.name} fill={SYSTEM_TYPE_COLORS[d.name] ?? 'var(--primary)'} />
            ))}
          </Pie>
        </PieChart>
      </ResponsiveContainer>
      <div className="pointer-events-none absolute inset-0 grid place-items-center text-center">
        <div>
          <b className="block text-2xl font-extrabold">{total}</b>
          <span className="text-[11px] text-muted-foreground">items</span>
        </div>
      </div>
    </div>
  )
}

export function MissionControlSparkline({ activity }: ActivityChartProps) {
  const data = useMemo(() => activity.slice(-21).map((d) => ({ count: d.count })), [activity])
  return (
    <ResponsiveContainer width="100%" height={28}>
      <AreaChart data={data} margin={{ top: 2, right: 0, bottom: 0, left: 0 }}>
        <Area type="monotone" dataKey="count" stroke="var(--primary)" strokeWidth={2} fill="var(--primary)" fillOpacity={0.12} isAnimationActive={false} />
      </AreaChart>
    </ResponsiveContainer>
  )
}

export function MissionControlHeatmap({ activity }: ActivityChartProps) {
  return (
    <ActivityCalendar
      data={activity}
      blockSize={11}
      blockMargin={4}
      showTotalCount={false}
      showColorLegend
      maxLevel={4}
      // Explicit hex scales (5 = maxLevel + 1). react-activity-calendar parses these internally, so
      // CSS variables can't be used here — keep concrete colors in the brand-blue ramp.
      theme={{
        light: ['#eceef2', '#bfdbfe', '#60a5fa', '#3b82f6', '#1d4ed8'],
        dark: ['#1b1e29', '#27407a', '#3b62c4', '#4f7cff', '#7aa2ff'],
      }}
      labels={{ totalCount: '{{count}} items in the last 12 weeks' }}
    />
  )
}
