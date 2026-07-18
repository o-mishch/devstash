import type { ReactNode } from 'react'
import { FileText } from 'lucide-react'
import { itemTypeMeta } from '@/lib/item-types'
import { cn } from '@/lib/utils'

interface ItemTypeIconProps {
  typeName: string
  className?: string
}

/**
 * The lucide glyph for an item type, tinted with its accent color. Unknown type names fall
 * back to a neutral document icon rather than throwing — a route param or stale item can
 * carry a name outside the current registry.
 */
export function ItemTypeIcon({ typeName, className }: ItemTypeIconProps): ReactNode {
  const meta = itemTypeMeta(typeName)
  const Icon = meta?.icon ?? FileText
  return (
    <Icon
      className={cn('size-4', meta?.accent ?? 'text-muted-foreground', className)}
      aria-hidden="true"
    />
  )
}
