'use client'

import { useState, useMemo, memo, type CSSProperties, type ReactNode } from 'react'
import { Collapsible, CollapsibleTrigger, CollapsibleContent } from '@/components/ui/collapsible'
import { cn } from '@/lib/utils'
import { CollapseChevron } from '@/components/shared/collapse-chevron'

interface CollapsibleCardProps {
  /** Header label (rendered as the toggle row). */
  title: ReactNode
  /**
   * Optional leading icon, passed as a RENDERED element (e.g. `<FolderPlus />`) — not a component type,
   * so this works across the RSC boundary (a server component can render the icon and pass the node).
   * Wrapped in a `card-icon` span so it grows on card hover; size/color come from the wrapper.
   */
  icon?: ReactNode
  /** Optional sub-line under the title (e.g. a short description). */
  subtitle?: ReactNode
  /** Trailing header content (badges, counts) rendered left of the chevron. */
  headerExtra?: ReactNode
  children: ReactNode
  defaultOpen?: boolean
  /** Per-session collapsed state is in-memory only (no persistence) — see feature scope. */
  /** Accent color for the left border (defaults to the theme primary on neutral widgets). */
  accentColor?: string
  /**
   * Elevation tier for nesting legibility. 1 = top-level widget (default), 2 = a card nested inside a
   * widget, 3 = a card nested two levels deep. Each step lifts the fill + border so containment reads
   * clearly. Pass the depth matching where this card sits.
   */
  tier?: 1 | 2 | 3
  className?: string
  bodyClassName?: string
}

const TIER_CLASS = { 1: 'card-tier-1', 2: 'card-tier-2', 3: 'card-tier-3' } as const

// The shared collapsible group widget: any card that groups multiple nested cards or inputs uses this so
// the whole app folds/unfolds consistently. Renders the unified card surface (always-on colored left
// border + hover highlight via `card-surface`/`card-hover`, `group` so the header icon grows on hover),
// a header that doubles as the collapse toggle, and an animated body (Base UI Collapsible). Collapsed
// state is per-session in-memory only.
export const CollapsibleCard = memo(function CollapsibleCard({
  title,
  icon,
  subtitle,
  headerExtra,
  children,
  defaultOpen = true,
  accentColor,
  tier = 1,
  className,
  bodyClassName,
}: CollapsibleCardProps) {
  const [open, setOpen] = useState(defaultOpen)

  const style = useMemo(() => {
    return accentColor ? ({ '--card-accent': accentColor } as CSSProperties) : undefined
  }, [accentColor])

  return (
    <Collapsible
      open={open}
      onOpenChange={setOpen}
      style={style}
      className={cn(
        'card-surface card-hover group rounded-xl border',
        TIER_CLASS[tier],
        className,
      )}
    >
      <CollapsibleTrigger
        aria-label={typeof title === 'string' ? `Toggle ${title}` : 'Toggle section'}
        className="flex w-full items-center gap-2 rounded-xl p-3 text-left outline-none focus-visible:ring-2 focus-visible:ring-ring sm:p-4"
      >
        {icon ? (
          <span className="card-icon inline-flex size-4 shrink-0 items-center justify-center text-muted-foreground [&>svg]:size-4">
            {icon}
          </span>
        ) : null}
        <div className="min-w-0 flex-1">
          <h3 className="truncate text-sm font-semibold">{title}</h3>
          {subtitle ? <p className="truncate text-xs text-muted-foreground">{subtitle}</p> : null}
        </div>
        {headerExtra}
        <CollapseChevron open={open} className="ml-1 size-4 text-muted-foreground" />
      </CollapsibleTrigger>
      <CollapsibleContent className={cn('px-3 pb-3 sm:px-4 sm:pb-4', bodyClassName)}>
        {children}
      </CollapsibleContent>
    </Collapsible>
  )
})
