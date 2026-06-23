'use client'

import { useState, type ReactNode } from 'react'
import { Collapsible, CollapsibleTrigger, CollapsibleContent } from '@/components/ui/collapsible'
import { CollapseChevron } from '@/components/shared/collapse-chevron'

interface CollapsibleSectionProps {
  title: string
  children: ReactNode
  defaultOpen?: boolean
}

// A labeled, collapsible group wrapper for the /parse index sections (In progress / History) — mirrors
// the dashboard group widgets so every list of cards on the page can be folded. Open by default.
export function CollapsibleSection({ title, children, defaultOpen = true }: CollapsibleSectionProps) {
  const [open, setOpen] = useState(defaultOpen)
  return (
    <Collapsible open={open} onOpenChange={setOpen} className="flex flex-col gap-2">
      <CollapsibleTrigger
        aria-label={`Toggle ${title} section`}
        className="group flex w-fit items-center gap-1.5 rounded-sm text-sm font-semibold text-muted-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        {title}
        <CollapseChevron open={open} className="group-hover:text-foreground" />
      </CollapsibleTrigger>
      <CollapsibleContent>{children}</CollapsibleContent>
    </Collapsible>
  )
}
