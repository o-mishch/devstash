import type { ReactNode } from 'react'
import { ItemTypeIcon } from '@/components/shared/item-type-icon'
import { cn } from '@/lib/utils'

interface ItemTypeRef {
  name: string
}

interface ItemIconWrapperProps {
  itemType: ItemTypeRef
  wrapperClassName?: string
  iconClassName?: string
}

/**
 * The type icon in a soft, type-tinted circular badge. The tint reads the `--item-color` CSS
 * variable set by the row/card, so a single element restyles when the row's dominant color
 * changes (see `item-row.tsx`).
 */
export function ItemIconWrapper({
  itemType,
  wrapperClassName,
  iconClassName,
}: ItemIconWrapperProps): ReactNode {
  return (
    <div
      className={cn(
        'flex shrink-0 items-center justify-center rounded-full bg-[color-mix(in_srgb,var(--item-color)_12%,transparent)]',
        wrapperClassName,
      )}
    >
      <ItemTypeIcon typeName={itemType.name} className={iconClassName} />
    </div>
  )
}
