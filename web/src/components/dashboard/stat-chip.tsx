import type { CSSProperties, ReactNode } from 'react'
import type { LucideIcon } from 'lucide-react'

// Responsive: two-up on mobile (so labels never truncate), even strip on sm+. STAT_CHIP_BASE holds
// the sizing/layout INCLUDING the 2px left-border gutter, so the loading skeleton can mirror the
// chip exactly with no 1px shift on load; STAT_CHIP_CLASS adds the hover/press lift + focus ring and
// recolors that left border to the per-card accent (dimmed at rest, full color on hover/press).
export const STAT_CHIP_BASE =
  'flex min-w-0 grow basis-[calc(50%-0.25rem)] items-center gap-3 rounded-xl border border-l-2 bg-card px-3 py-2 sm:basis-0'

export const STAT_CHIP_CLASS = `${STAT_CHIP_BASE} group/chip transition-transform border-l-[color-mix(in_oklab,var(--stat-accent),transparent_45%)] hover:-translate-y-0.5 hover:border-l-[var(--stat-accent)] active:border-l-[var(--stat-accent)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring`

// Feeds the per-card accent into STAT_CHIP_CLASS's left border via a CSS var. Apply to the chip's
// root element alongside STAT_CHIP_CLASS.
export function statAccentStyle(color: string): CSSProperties {
  return { '--stat-accent': color }
}

// Per-stat accent palette (distinct from the item-type colors) — one source of truth for the
// dashboard stat strip, shared by the chips and the Total Items launcher.
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

/** The inner icon-badge + value + label of a stat chip. Wrapped by a `<Link>` at the call site. */
export function StatChipBody({ icon: Icon, value, label, color }: StatChipBodyProps): ReactNode {
  return (
    <>
      <span
        className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-[color-mix(in_oklab,var(--chip-icon-color)_12%,transparent)] transition-transform duration-300 group-hover/chip:scale-105"
        // oxlint-disable-next-line react/forbid-dom-props -- dynamic CSS custom property (chip icon color)
        style={{ '--chip-icon-color': color }}
      >
        <Icon className="size-[18px] text-[var(--chip-icon-color)]" aria-hidden="true" />
      </span>
      <div className="min-w-0 text-left">
        <p className="text-lg font-semibold leading-none tabular-nums">{value}</p>
        <p className="mt-1 truncate text-xs text-muted-foreground">{label}</p>
      </div>
    </>
  )
}
