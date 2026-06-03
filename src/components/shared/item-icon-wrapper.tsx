import { ItemTypeIcon } from '@/components/shared/item-type-icon'
import { cn } from '@/lib/utils'
import type { ItemType } from '@/types/item'

interface ItemIconWrapperProps {
  itemType: ItemType | { icon: string; color?: string | null }
  wrapperClassName?: string
  iconClassName?: string
}

export function ItemIconWrapper({ itemType, wrapperClassName, iconClassName }: ItemIconWrapperProps) {
  return (
    <div className={cn("flex shrink-0 items-center justify-center rounded-full bg-[color-mix(in_srgb,var(--item-color)_12%,transparent)]", wrapperClassName)}>
      <ItemTypeIcon iconName={itemType.icon} color={itemType.color} className={iconClassName} />
    </div>
  )
}
