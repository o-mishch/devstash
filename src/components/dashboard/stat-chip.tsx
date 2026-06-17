import type { LucideIcon } from 'lucide-react'

// Responsive: two-up on mobile (so labels never truncate), even strip on sm+.
// STAT_CHIP_BASE holds the sizing/layout so the loading skeleton can mirror the
// chip exactly; STAT_CHIP_CLASS adds the `card-interactive` hover lift + focus ring
// for the real clickable chips.
export const STAT_CHIP_BASE =
  'flex min-w-0 grow basis-[calc(50%-0.25rem)] items-center gap-3 rounded-xl border bg-card px-3 py-2.5 sm:basis-0'

export const STAT_CHIP_CLASS = `${STAT_CHIP_BASE} card-interactive focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring`

// Per-stat accent palette (distinct from the item-type colors) — one source of truth for the
// dashboard stat strip, shared by the chips and the Total Items fan-out launcher.
export const STAT_COLORS = {
  total: '#3b82f6',
  collections: '#6366f1',
  favoriteItems: '#f97316',
  favoriteCollections: '#10b981',
} as const

interface StatChipBodyProps {
  icon: LucideIcon
  value: number
  label: string
  color: string
}

export function StatChipBody({ icon: Icon, value, label, color }: StatChipBodyProps) {
  return (
    <>
      <span
        className="flex size-9 shrink-0 items-center justify-center rounded-lg"
        style={{ backgroundColor: `${color}1f` }}
      >
        <Icon className="size-5" style={{ color }} aria-hidden="true" />
      </span>
      <div className="min-w-0 text-left">
        <p className="text-lg font-semibold leading-none tabular-nums">{value}</p>
        <p className="mt-1 truncate text-xs text-muted-foreground">{label}</p>
      </div>
    </>
  )
}
