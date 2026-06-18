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
    <Collapsible open={isOpen} onOpenChange={setIsOpen}>
      <Card
        className={cn(
          'bg-[var(--muted,var(--background))] border-l-2 border-l-accent',
          overflowVisible && 'overflow-visible'
        )}
      >
        <CardHeader className={cn('pb-3', headerAction && 'flex flex-row items-center justify-between')}>
          <CollapsibleTrigger className="group flex select-none items-center gap-1.5 rounded-sm text-left outline-none focus-visible:ring-2 focus-visible:ring-ring">
            <CardTitle className="flex items-center gap-1.5 text-sm font-semibold">
              <Icon className="size-3.5 text-accent" />
              {title}
            </CardTitle>
            <ChevronDown
              className={cn(
                'size-3.5 text-muted-foreground group-hover:text-foreground transition-transform duration-300 ease-in-out',
                !isOpen && '-rotate-90'
              )}
            />
          </CollapsibleTrigger>
          {headerAction}
        </CardHeader>
        <CollapsibleContent className={cn(overflowVisible && 'pt-0', overflowVisible && isOpen && '!overflow-visible')}>
          <CardContent className={cn(overflowVisible && 'overflow-visible pt-0 pb-0')}>{children}</CardContent>
        </CollapsibleContent>
      </Card>
    </Collapsible>
  )
}
