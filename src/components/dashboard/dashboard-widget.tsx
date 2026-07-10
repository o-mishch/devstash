'use client'

import { useMemo, useState, type CSSProperties, type ReactNode } from 'react'
import { ChevronDown, type LucideIcon } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Collapsible, CollapsibleTrigger, CollapsibleContent } from '@/components/ui/collapsible'
import { cn } from '@/lib/utils'

interface DashboardWidgetProps {
  icon: LucideIcon
  title: string
  children: ReactNode
  headerAction?: ReactNode
  // Left-border accent color. When set (e.g. the dominant item-type color of the widget's contents),
  // it overrides the default token-based accent. Falls back to the neutral accent when omitted.
  accentColor?: string
}

// The classic dashboard widget shell: a collapsible Card with an icon + title header. Widgets render
// open by default and can be toggled in-session, but the open/closed state is no longer persisted or
// restored across loads (collapse persistence was removed with the skin work).
export function DashboardWidget({
  icon: Icon,
  title,
  children,
  headerAction,
  accentColor,
}: DashboardWidgetProps) {
  const [isOpen, setIsOpen] = useState(true)
  const accentStyle = useMemo(
    () => (accentColor ? ({ '--widget-accent': accentColor } as CSSProperties) : undefined),
    [accentColor],
  )

  return (
    <Collapsible open={isOpen} onOpenChange={setIsOpen}>
      {/* Hover highlight uses background + border, NOT opacity: opacity on the Card cascades to and
          dims the item cards inside it, whereas a background/border change leaves the inner cards
          (which paint on top with their own backgrounds) untouched. So the group highlights while its
          inner cards stay unaffected. */}
      <Card
        className={cn(
          // Translucent surface matching the Brain Dump bento buckets (bg-muted/20 → hover bg-muted/40):
          // an alpha-channel background, not the `opacity` property, so it does NOT cascade to the inner
          // item cards (see note above) while still reading as a light, see-through group surface.
          'bg-muted/20 border-l-2 transition-colors hover:bg-muted/40 active:bg-muted/40',
          // The left border is visible at rest but dimmed, and brightens to its full color on
          // hover/press (press = touch, where there is no hover). With a dominant item-type color the
          // rest/active pair is that color dimmed → full; without one it stays the neutral accent →
          // primary token, like the Collections/AI Usage widgets.
          accentColor
            ? 'border-l-[color-mix(in_oklab,var(--widget-accent),transparent_45%)] hover:border-l-[var(--widget-accent)] active:border-l-[var(--widget-accent)]'
            : 'border-l-accent hover:border-l-primary active:border-l-primary'
        )}
        style={accentStyle}
      >
        <CardHeader className="group relative pb-3">
          {/* Full-header click target: covers the entire header so a click anywhere toggles the
              section. The visible row sits above it (pointer-events-none) and passes clicks through;
              the header action opts back in (pointer-events-auto) so its own link/button still works.
              -top-4/-bottom-4 reach past the header into the Card's own py-4 padding so the whole
              card bar is clickable, not just the header box. When open we stop at the header bottom
              (bottom-0) so the expanded content stays interactive. */}
          <CollapsibleTrigger
            aria-label={`Toggle ${title} section`}
            className={cn(
              'absolute inset-x-0 -top-4 rounded-sm outline-none focus-visible:ring-2 focus-visible:ring-ring',
              isOpen ? 'bottom-0' : '-bottom-4'
            )}
          />
          <div className="pointer-events-none relative flex w-full items-center justify-between gap-4">
            <CardTitle className="flex select-none items-center gap-1.5 text-sm font-semibold">
              <Icon className="size-3.5 text-primary card-icon" />
              {title}
              <ChevronDown
                className={cn(
                  'size-3.5 text-muted-foreground group-hover:text-foreground transition-transform duration-700 ease-[cubic-bezier(0.4,0,0.2,1)]',
                  !isOpen && '-rotate-90'
                )}
              />
            </CardTitle>
            {headerAction && (
              <div className="pointer-events-auto shrink-0">
                {headerAction}
              </div>
            )}
          </div>
        </CardHeader>
        <CollapsibleContent>
          {/* pt-1 gives the first row room for its hover lift (.card-interactive's -translate-y-1);
              without it the lifted top border is clipped by the panel's overflow-hidden. */}
          <CardContent className="pt-2">{children}</CardContent>
        </CollapsibleContent>
      </Card>
    </Collapsible>
  )
}
