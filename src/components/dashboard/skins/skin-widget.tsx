'use client'

import { useState, type ReactNode } from 'react'
import { ChevronDown } from 'lucide-react'
import { Collapsible, CollapsibleTrigger, CollapsibleContent } from '@/components/ui/collapsible'
import { cn } from '@/lib/utils'
import type { UiSkin } from '@/types/ui-skins'

// Single source of truth for each skin's SkinWidget header-wrapper padding: negative margins bleed the
// full-width clickable header out to the panel edges, then the panel's own padding is restored.
const SKIN_HEADER_WRAPPER_CLASS: Partial<Record<UiSkin, string>> = {
  orbital: '-mx-5 -mt-5 px-5 pt-5 pb-3',
  'mission-control': '-mx-5 -mt-5 px-5 pt-5 pb-3',
  'neon-grid': '-mx-5 -mt-5 px-5 pt-5 pb-3',
  holographic: '-mx-[22px] -mt-[22px] px-[22px] pt-[22px] pb-3',
  spatial: '-mx-6 -mt-6 px-6 pt-6 pb-3',
  aurora: '-mx-5 -mt-5 px-5 pt-5 pb-3',
  'command-deck': '-mx-5 -mt-5 px-5 pt-5 pb-3',
}

interface SkinWidgetProps {
  icon?: ReactNode
  title: string
  count?: number
  /** Matches the per-skin header className (font/color/tracking) so the toggle header
      keeps each skin's identity. */
  headerClassName?: string
  contentClassName?: string
  children: ReactNode
  /** When set (and `headerWrapperClassName` is not), the wrapper class is resolved from
      `SKIN_HEADER_WRAPPER_CLASS[skin]` so call sites pass `skin` instead of the lookup. */
  skin?: UiSkin
  /** Explicit override; takes precedence over the `skin` lookup. */
  headerWrapperClassName?: string
}

// A skin-agnostic collapsible dashboard widget: the header doubles as the toggle (chevron +
// full-width click target), content collapses below it. The skin keeps its own panel chrome around
// this — the component owns only the header row + collapsible body, so it drops into any skin's
// panel (glass, HUD, foil, neon) unchanged. State is in-session only (default open), never persisted
// — matching the dashboard's collapse-persistence removal. The header doubles as the collapse control,
// so inline "View all →" actions are dropped.
export function SkinWidget({
  icon,
  title,
  count,
  headerClassName,
  contentClassName,
  children,
  skin,
  headerWrapperClassName,
}: SkinWidgetProps) {
  const [open, setOpen] = useState(true)
  const wrapperClass = headerWrapperClassName ?? (skin ? SKIN_HEADER_WRAPPER_CLASS[skin] : undefined)

  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <div className={cn('group relative', wrapperClass || '-mx-2 px-2 py-1.5 rounded-md')}>
        <CollapsibleTrigger
          aria-label={`Toggle ${title} section`}
          className="absolute inset-0 z-10 rounded-[inherit] outline-none transition-all hover:bg-foreground/5 focus-visible:ring-2 focus-visible:ring-ring"
        />
        <div
          className={cn(
            'pointer-events-none relative flex w-full items-center gap-2.5 text-[13px] font-bold uppercase tracking-[0.06em] text-muted-foreground transition-colors group-hover:text-foreground',
            headerClassName,
          )}
        >
          {icon && <span className="inline-flex text-primary [&_svg]:size-[15px]">{icon}</span>}
          {title}
          {typeof count === 'number' && (
            <span className="rounded-full bg-foreground/5 px-2 py-0.5 text-[11px] font-medium normal-case tracking-normal">{count}</span>
          )}
          <ChevronDown
            className={cn(
              'ml-auto size-4 shrink-0 transition-transform duration-700 ease-[cubic-bezier(0.4,0,0.2,1)]',
              !open && '-rotate-90',
            )}
          />
        </div>
      </div>
      {/* The header↔content gap (pt-3.5) lives INSIDE the collapsible panel so it animates with the
          height instead of snapping — otherwise a toggled header margin would jump 14px while the
          body is still tweening. */}
      <CollapsibleContent className={cn('pt-3.5', contentClassName)}>{children}</CollapsibleContent>
    </Collapsible>
  )
}
