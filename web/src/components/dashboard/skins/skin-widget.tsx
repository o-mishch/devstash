import { useState } from 'react'
import type { ReactNode } from 'react'
import { ChevronDown } from 'lucide-react'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import { cn } from '@/lib/utils'
import type { UiSkin } from '@/lib/ui-skins'

// Per-skin header-wrapper padding: negative margins bleed the full-width clickable header out to the
// panel edges, then restore the panel's own padding. Mirrors the legacy lookup table.
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
  /** Matches the per-skin header className (font/color/tracking) so the toggle keeps each skin's identity. */
  headerClassName?: string
  children: ReactNode
  /** Resolves the header-wrapper padding from `SKIN_HEADER_WRAPPER_CLASS[skin]`. */
  skin?: UiSkin
  /** Skins whose panel chrome already supplies the header hover affordance set this to avoid a double hover. */
  headerHoverless?: boolean
}

/**
 * A skin-agnostic collapsible dashboard widget: the header doubles as the toggle (chevron +
 * full-width click target), content collapses below it. Each skin keeps its own panel chrome around
 * this — the component owns only the header row + collapsible body, so it drops into any skin's
 * panel (glass, HUD, foil, neon) unchanged. Open by default; state is in-session only.
 */
export function SkinWidget({
  icon,
  title,
  count,
  headerClassName,
  children,
  skin,
  headerHoverless = false,
}: SkinWidgetProps): ReactNode {
  // Controlled so the chevron (a sibling of the overlay trigger, not a child) can read the open
  // state directly — Base UI's `data-panel-open` sits on the trigger, which the chevron can't group
  // off of here.
  const [open, setOpen] = useState(true)
  const wrapperClass = skin ? SKIN_HEADER_WRAPPER_CLASS[skin] : undefined

  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <div className={cn('group relative', wrapperClass ?? '-mx-2 rounded-md px-2 py-1.5')}>
        <CollapsibleTrigger
          className={cn(
            'absolute inset-0 z-10 rounded-[inherit] outline-none transition-all focus-visible:ring-2 focus-visible:ring-ring',
            !headerHoverless && 'hover:bg-foreground/5',
          )}
          aria-label={`Toggle ${title} section`}
        />
        <div
          className={cn(
            'pointer-events-none relative flex w-full items-center gap-2.5 text-[13px] font-bold uppercase tracking-[0.06em] text-muted-foreground transition-colors group-hover:text-foreground',
            headerClassName,
          )}
        >
          {icon != null && (
            <span className="inline-flex text-primary [&_svg]:size-[15px]">{icon}</span>
          )}
          {title}
          {typeof count === 'number' && (
            <span className="rounded-full bg-foreground/5 px-2 py-0.5 text-[11px] font-medium normal-case tracking-normal">
              {count}
            </span>
          )}
          <ChevronDown
            className={cn(
              'ml-auto size-4 shrink-0 transition-transform duration-300',
              !open && '-rotate-90',
            )}
          />
        </div>
      </div>
      <CollapsibleContent className="pt-3.5">{children}</CollapsibleContent>
    </Collapsible>
  )
}
