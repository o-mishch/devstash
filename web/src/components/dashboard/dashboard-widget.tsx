import { useState } from 'react'
import type { ReactNode } from 'react'
import { ChevronDown } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import { cn } from '@/lib/utils'

interface DashboardWidgetProps {
  icon: LucideIcon
  title: string
  children: ReactNode
  headerAction?: ReactNode
  /**
   * Left-border accent color (e.g. the dominant item-type color of the widget's contents). When
   * set it overrides the default token accent. Dimmed at rest, full color on hover.
   */
  accentColor?: string
}

/**
 * The classic dashboard widget shell: a collapsible translucent card with an icon + title header.
 * Widgets render open by default and toggle in-session — `open` is held in local state (not just
 * `defaultOpen`) so the collapse state survives parent re-renders instead of resetting on every
 * data update or skin change. The header row is the toggle; an optional `headerAction` (e.g. "View
 * all") sits beside it as a sibling so it isn't a control nested inside the trigger button.
 */
export function DashboardWidget({
  icon: Icon,
  title,
  children,
  headerAction,
  accentColor,
}: DashboardWidgetProps): ReactNode {
  const [isOpen, setIsOpen] = useState(true)
  const accentStyle = accentColor === undefined ? undefined : { '--widget-accent': accentColor }

  return (
    <Collapsible open={isOpen} onOpenChange={setIsOpen}>
      <div
        className={cn(
          'rounded-xl border-l-2 bg-muted/20 ring-1 ring-foreground/10 transition-colors hover:bg-muted/40',
          accentColor === undefined
            ? 'border-l-accent hover:border-l-primary active:border-l-primary'
            : 'border-l-[color-mix(in_oklab,var(--widget-accent),transparent_45%)] hover:border-l-[var(--widget-accent)] active:border-l-[var(--widget-accent)]',
        )}
        // oxlint-disable-next-line react/forbid-dom-props -- dynamic CSS custom property (widget accent)
        style={accentStyle}
      >
        <div className="flex items-center justify-between gap-4 px-4 py-3">
          <CollapsibleTrigger className="group flex flex-1 select-none items-center gap-1.5 text-sm font-semibold outline-none focus-visible:ring-2 focus-visible:ring-ring">
            <Icon className="size-3.5 text-primary" />
            {title}
            <ChevronDown className="size-3.5 -rotate-90 text-muted-foreground transition-transform duration-300 group-data-[panel-open]:rotate-0" />
          </CollapsibleTrigger>
          {headerAction != null && <div className="shrink-0">{headerAction}</div>}
        </div>
        <CollapsibleContent className="px-4 pb-4 pt-1">{children}</CollapsibleContent>
      </div>
    </Collapsible>
  )
}
