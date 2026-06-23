import { ChevronDown } from 'lucide-react'
import { cn } from '@/lib/utils'

interface CollapseChevronProps {
  open: boolean
  className?: string
}

// Shared fold affordance for collapsible headers (parse buckets, /parse sections, collapsible cards): a
// ChevronDown that rotates -90° when collapsed. The rotate + transition rule lives here so every collapsible
// shares one source of truth; `className` tunes size/color/margin per call site.
export function CollapseChevron({ open, className }: CollapseChevronProps) {
  return (
    <ChevronDown
      className={cn('size-3.5 shrink-0 transition-transform duration-300', !open && '-rotate-90', className)}
    />
  )
}
