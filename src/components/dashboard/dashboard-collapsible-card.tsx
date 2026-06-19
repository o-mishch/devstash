'use client'

import type { ReactNode } from 'react'
import { ChevronDown, type LucideIcon } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Collapsible, CollapsibleTrigger, CollapsibleContent } from '@/components/ui/collapsible'
import { useDashboardSectionsStore } from '@/stores/dashboard-sections'
import { cn } from '@/lib/utils'

type DashboardSection = 'collections' | 'pinned' | 'recent'

interface DashboardCollapsibleCardProps {
  icon: LucideIcon
  title: string
  section: DashboardSection
  children: ReactNode
  headerAction?: ReactNode
  // The collections grid renders overflowing menus, so its card must not clip.
  overflowVisible?: boolean
}

export function DashboardCollapsibleCard({
  icon: Icon,
  title,
  section,
  children,
  headerAction,
  overflowVisible = false,
}: DashboardCollapsibleCardProps) {
  const isOpen = useDashboardSectionsStore((s) => s[section])
  const setOpen = useDashboardSectionsStore((s) => s.setOpen)
  const setIsOpen = (open: boolean) => setOpen(section, open)

  return (
    <Collapsible open={isOpen} onOpenChange={setIsOpen} data-section={section}>
      <Card
        className={cn(
          'bg-[var(--muted,var(--background))] border-l-2 border-l-accent transition-opacity duration-150 hover:opacity-80',
          overflowVisible && 'overflow-visible'
        )}
      >
        <CardHeader className="pb-3">
          <div className="flex w-full items-center justify-between gap-4">
            <CollapsibleTrigger className="group flex flex-1 select-none items-center gap-1.5 rounded-sm text-left outline-none focus-visible:ring-2 focus-visible:ring-ring">
              <CardTitle className="flex items-center gap-1.5 text-sm font-semibold">
                <Icon className="size-3.5 text-primary" />
                {title}
                <ChevronDown
                  className={cn(
                    'size-3.5 text-muted-foreground group-hover:text-foreground transition-transform duration-300 ease-in-out',
                    !isOpen && '-rotate-90'
                  )}
                />
              </CardTitle>
            </CollapsibleTrigger>
            {headerAction && (
              <div className="shrink-0">
                {headerAction}
              </div>
            )}
          </div>
        </CardHeader>
        <CollapsibleContent className={cn(overflowVisible && 'pt-0', overflowVisible && isOpen && '!overflow-visible')}>
          <CardContent className={cn(overflowVisible && 'overflow-visible pt-0 pb-0')}>{children}</CardContent>
        </CollapsibleContent>
      </Card>
    </Collapsible>
  )
}
