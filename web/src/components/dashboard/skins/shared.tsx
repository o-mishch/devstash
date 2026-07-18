import type { CSSProperties, ReactNode } from 'react'
import { Link } from '@tanstack/react-router'
import type { ItemTypeCount } from '@/client'
import { FREE_TIER_ITEM_LIMIT } from '@/lib/limits'
import { typeColor } from '@/lib/type-colors'
import type { DashboardData } from '@/hooks/use-dashboard'

export { typeColor }

// Re-export so every skin imports its data contract from one place next to the shared widgets.
export type { DashboardData }

export interface SkinUsage {
  totalItems: number
  limit: number
  pct: number
  slotsLeft: number
  isPro: boolean
}

/** Free-tier usage math shared by every skin's usage ring / bar. */
export function computeUsage(totalItems: number, isPro: boolean): SkinUsage {
  const limit = FREE_TIER_ITEM_LIMIT
  const pct = Math.min(100, Math.round((totalItems / limit) * 100))
  return { totalItems, limit, pct, slotsLeft: Math.max(0, limit - totalItems), isPro }
}

export function usageLabel(usage: SkinUsage): string {
  if (usage.isPro) return `${usage.totalItems} items · Pro · unlimited`
  return `${usage.slotsLeft} of ${usage.limit} free slots left`
}

/** The internal routes a stat tile / KPI can deep-link to. */
export type SkinLinkTarget = '/collections' | '/favorites'

interface MaybeLinkProps {
  /** When set, the tile is a real router link; otherwise a plain div. */
  to?: SkinLinkTarget
  className?: string
  style?: CSSProperties
  children: ReactNode
}

/**
 * Stat-tile wrapper: a `<Link>` when `to` is set, otherwise a plain `<div>`. Collapses the
 * `to ? <Link> : <div>` ternary the bento/HUD/neon skins repeat around their tile markup.
 */
export function MaybeLink({ to, className, style, children }: MaybeLinkProps): ReactNode {
  if (to) {
    return (
      <Link
        to={to}
        className={className}
        // oxlint-disable-next-line react/forbid-component-props -- forwards caller-provided dynamic style
        style={style}
      >
        {children}
      </Link>
    )
  }
  return (
    <div
      className={className}
      // oxlint-disable-next-line react/forbid-dom-props -- forwards caller-provided dynamic style
      style={style}
    >
      {children}
    </div>
  )
}

interface TypeLinkProps {
  name: string
  className?: string
  children: ReactNode
}

/** A link to a type's item list — the TanStack equivalent of the legacy `getTypeHref`. */
export function TypeLink({ name, className, children }: TypeLinkProps): ReactNode {
  return (
    <Link to="/items/$type" params={{ type: name }} className={className}>
      {children}
    </Link>
  )
}

interface TypeDistributionBarsProps {
  distribution: ItemTypeCount[]
}

/** Per-type horizontal distribution bars — plain divs, no chart lib. */
export function TypeDistributionBars({ distribution }: TypeDistributionBarsProps): ReactNode {
  const max = Math.max(1, ...distribution.map((d) => d.count))
  const visible = distribution.filter((d) => d.count > 0)
  const rows = visible.length > 0 ? visible : distribution.slice(0, 3)

  return (
    <div className="flex flex-col gap-1">
      {rows.map((d) => (
        <TypeLink
          key={d.name}
          name={d.name}
          className="-mx-1.5 flex items-center gap-3 rounded-md px-1.5 py-1 text-xs transition-colors hover:bg-foreground/5"
        >
          <span className="w-16 shrink-0 capitalize text-muted-foreground">{d.name}</span>
          <span className="h-[7px] flex-1 overflow-hidden rounded-full bg-foreground/5">
            <span
              className="block h-full w-[var(--ds-bar-pct)] rounded-full bg-[var(--ds-bar-color)]"
              // oxlint-disable-next-line react/forbid-dom-props -- dynamic CSS custom properties
              style={{
                '--ds-bar-pct': `${Math.round((d.count / max) * 100)}%`,
                '--ds-bar-color': typeColor(d.name),
              }}
            />
          </span>
          <span className="w-6 shrink-0 text-right tabular-nums text-muted-foreground">
            {d.count}
          </span>
        </TypeLink>
      ))}
    </div>
  )
}

/**
 * Column classes for a skin's KPI stat row: 4 even columns for the Pro layout, else 3 with the
 * last cell spanning 2 on small screens. Shared so a change to this responsive rule lands once
 * rather than being edited byte-for-byte in every skin.
 */
export function statGridColsClass(fourColumns: boolean): string {
  return fourColumns
    ? 'lg:grid-cols-4'
    : 'lg:grid-cols-3 [&>*:last-child]:col-span-2 lg:[&>*:last-child]:col-span-1'
}

interface TypeDistributionSegmentsProps {
  distribution: ItemTypeCount[]
}

/** Segmented single-bar distribution + legend (HUD / neon skins). */
export function TypeDistributionSegments({
  distribution,
}: TypeDistributionSegmentsProps): ReactNode {
  const visible = distribution.filter((d) => d.count > 0)
  const segments = visible.length > 0 ? visible : distribution.slice(0, 1)

  return (
    <div>
      <div className="mb-3 flex h-7 overflow-hidden rounded-md">
        {segments.map((d) => (
          // `|| 1` keeps a zero-count segment visible with a sliver of width instead of collapsing
          // to nothing (this only renders when every type is zero — see `segments` above).
          <span
            key={d.name}
            className="grow-[var(--ds-seg-grow)] bg-[var(--ds-seg-color)]"
            // oxlint-disable-next-line react/forbid-dom-props -- dynamic CSS custom properties (segment size/color)
            style={{ '--ds-seg-grow': d.count || 1, '--ds-seg-color': typeColor(d.name) }}
          />
        ))}
      </div>
      <div className="flex flex-wrap gap-x-2 gap-y-1">
        {distribution.map((d) => (
          <TypeLink
            key={d.name}
            name={d.name}
            className="-mx-1 flex items-center gap-2 rounded-md px-1.5 py-1 text-xs text-muted-foreground transition-colors hover:bg-foreground/5 hover:text-foreground"
          >
            <span
              className="size-2 rounded-full bg-[var(--ds-dot-color)]"
              // oxlint-disable-next-line react/forbid-dom-props -- dynamic CSS custom property (legend color)
              style={{ '--ds-dot-color': typeColor(d.name) }}
            />
            <span className="capitalize">{d.name}</span>
            <b className="tabular-nums text-foreground">{d.count}</b>
          </TypeLink>
        ))}
      </div>
    </div>
  )
}
