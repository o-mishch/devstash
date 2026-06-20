'use client'

import { useState, type ReactNode } from 'react'
import { ChevronDown } from 'lucide-react'
import { Collapsible, CollapsibleTrigger, CollapsibleContent } from '@/components/ui/collapsible'
import { cn } from '@/lib/utils'

interface SkinCollapsibleSectionProps {
  icon?: ReactNode
  title: string
  count?: number
  /** Matches the per-skin SkinSectionHeader className (font/color/tracking) so the toggle header
      keeps each skin's identity. */
  headerClassName?: string
  contentClassName?: string
  children: ReactNode
}

// A skin-agnostic collapsible group card: the section header doubles as the toggle (chevron +
// full-width click target), content collapses below it. The skin keeps its own panel chrome around
// this — the component owns only the header row + collapsible body, so it drops into any skin's
// panel (glass, HUD, foil, neon) unchanged. State is in-session only (default open), never persisted
// — matching the dashboard's collapse-persistence removal. Replaces SkinSectionHeader where a
// section should collapse; inline "View all →" actions are dropped (the header is now the control).
export function SkinCollapsibleSection({
  icon,
  title,
  count,
  headerClassName,
  contentClassName,
  children,
}: SkinCollapsibleSectionProps) {
  const [open, setOpen] = useState(true)

  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <CollapsibleTrigger
        aria-label={`Toggle ${title} section`}
        className={cn(
          'flex w-full items-center gap-2.5 text-[13px] font-bold uppercase tracking-[0.06em] text-muted-foreground outline-none transition-colors hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring',
          headerClassName,
        )}
      >
        {icon && <span className="inline-flex text-primary [&_svg]:size-[15px]">{icon}</span>}
        {title}
        {typeof count === 'number' && (
          <span className="rounded-full bg-foreground/5 px-2 py-0.5 text-[11px] font-medium normal-case tracking-normal">{count}</span>
        )}
        <ChevronDown className={cn('ml-auto size-4 shrink-0 transition-transform duration-700 ease-[cubic-bezier(0.4,0,0.2,1)]', !open && '-rotate-90')} />
      </CollapsibleTrigger>
      {/* The header↔content gap (pt-3.5) lives INSIDE the collapsible panel so it animates with the
          height instead of snapping — otherwise a toggled header margin would jump 14px while the
          body is still tweening. */}
      <CollapsibleContent className={cn('pt-3.5', contentClassName)}>{children}</CollapsibleContent>
    </Collapsible>
  )
}
