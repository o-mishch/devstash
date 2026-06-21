'use client'

import { useMemo } from 'react'
import { ActivityCalendar } from 'react-activity-calendar'
import { motion, useReducedMotion } from 'motion/react'
import { SYSTEM_TYPE_COLORS } from '@/lib/utils/constants'
import type { ItemTypeDistribution, DashboardActivityDay } from '@/types/item'

// Chart widgets for the mission-control skin. Lazy-loaded (ssr:false) from charts-island.tsx so
// motion + react-activity-calendar never ship on the default/classic dashboard path. The donut and
// sparkline are hand-rolled SVG (donut animated with motion) — no charting dependency.

interface MissionControlDonutProps {
  distribution: ItemTypeDistribution[]
}

interface ActivityChartProps {
  activity: DashboardActivityDay[]
}

// Donut geometry: ring centered in a 150×150 box. Radius is the midline of a 20px-wide stroke
// (matches the old innerRadius 54 / outerRadius 74). Segments are drawn as dashed circle arcs with a
// ~2° gap between them (the old paddingAngle).
const DONUT_RADIUS = 64
const DONUT_STROKE = 20
const DONUT_CIRCUMFERENCE = 2 * Math.PI * DONUT_RADIUS
const DONUT_GAP = (2 / 360) * DONUT_CIRCUMFERENCE

interface DonutSegment {
  name: string
  color: string
  length: number
  offset: number
}

export function MissionControlDonut({ distribution }: MissionControlDonutProps) {
  const reduceMotion = useReducedMotion()
  const data = useMemo(() => distribution.filter((d) => d.count > 0), [distribution])
  const total = data.reduce((sum, d) => sum + d.count, 0)

  const segments = useMemo<DonutSegment[]>(() => {
    if (total === 0) return []
    let start = 0
    // A single type fills the ring — no inter-segment gap to carve out (the gap would leave a notch
    // on an otherwise solid 100% ring).
    const gap = data.length > 1 ? DONUT_GAP : 0
    return data.map((d) => {
      const fraction = d.count / total
      const length = Math.max(fraction * DONUT_CIRCUMFERENCE - gap, 0)
      const offset = -start * DONUT_CIRCUMFERENCE
      start += fraction
      return { name: d.name, color: SYSTEM_TYPE_COLORS[d.name] ?? 'var(--primary)', length, offset }
    })
  }, [data, total])

  if (total === 0) {
    return <div className="grid h-[150px] place-items-center text-sm text-muted-foreground">No items yet</div>
  }

  return (
    <div className="relative mx-auto h-[150px] w-[150px]">
      {/* -rotate-90 starts the first segment at 12 o'clock instead of 3 o'clock. */}
      <svg viewBox="0 0 150 150" className="h-full w-full -rotate-90" aria-hidden="true">
        {segments.map((s, i) => (
          <motion.circle
            key={s.name}
            cx={75}
            cy={75}
            r={DONUT_RADIUS}
            fill="none"
            stroke={s.color}
            strokeWidth={DONUT_STROKE}
            strokeDashoffset={s.offset}
            initial={{ strokeDasharray: `0 ${DONUT_CIRCUMFERENCE}` }}
            animate={{ strokeDasharray: `${s.length} ${DONUT_CIRCUMFERENCE - s.length}` }}
            // Reduced-motion: snap straight to the final ring (no sweep) instead of animating in.
            transition={reduceMotion ? { duration: 0 } : { duration: 0.8, delay: i * 0.08, ease: 'easeOut' }}
          />
        ))}
      </svg>
      <div className="pointer-events-none absolute inset-0 grid place-items-center text-center">
        <div>
          <b className="block text-2xl font-extrabold">{total}</b>
          <span className="text-[11px] text-muted-foreground">items</span>
        </div>
      </div>
    </div>
  )
}

// Sparkline drawn into a 100×28 viewBox, stretched to the container width (preserveAspectRatio=none).
// vector-effect keeps the stroke an even 2px despite the non-uniform horizontal scale.
const SPARK_W = 100
const SPARK_H = 28

interface SparklinePaths {
  line: string
  area: string
}

export function MissionControlSparkline({ activity }: ActivityChartProps) {
  const { line, area } = useMemo<SparklinePaths>(() => {
    const counts = activity.slice(-21).map((d) => d.count)
    if (counts.length === 0) return { line: '', area: '' }
    const max = Math.max(...counts, 1)
    // A single day has no horizontal span: draw a flat segment across the full width so the lone point
    // renders as a visible baseline instead of a zero-length (invisible) path.
    if (counts.length === 1) {
      const y = (SPARK_H - (counts[0] / max) * SPARK_H).toFixed(2)
      const flat = `M0 ${y} L${SPARK_W} ${y}`
      return { line: flat, area: `${flat} L${SPARK_W} ${SPARK_H} L0 ${SPARK_H} Z` }
    }
    const step = SPARK_W / (counts.length - 1)
    const points = counts.map((c, i) => {
      const x = (i * step).toFixed(2)
      const y = (SPARK_H - (c / max) * SPARK_H).toFixed(2)
      return `${i === 0 ? 'M' : 'L'}${x} ${y}`
    })
    const line = points.join(' ')
    return { line, area: `${line} L${SPARK_W} ${SPARK_H} L0 ${SPARK_H} Z` }
  }, [activity])

  if (!line) return <div className="h-[28px] w-full" />

  return (
    <svg viewBox={`0 0 ${SPARK_W} ${SPARK_H}`} preserveAspectRatio="none" className="h-[28px] w-full" aria-hidden="true">
      <path d={area} fill="var(--primary)" fillOpacity={0.12} stroke="none" />
      <path
        d={line}
        fill="none"
        stroke="var(--primary)"
        strokeWidth={2}
        strokeLinejoin="round"
        strokeLinecap="round"
        vectorEffect="non-scaling-stroke"
      />
    </svg>
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
