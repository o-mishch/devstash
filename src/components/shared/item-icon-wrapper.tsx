import { ItemTypeIcon } from '@/components/shared/item-type-icon'
import { cn } from '@/lib/utils'

interface ItemIconWrapperProps {
  itemType: { name: string }
  wrapperClassName?: string
  iconClassName?: string
}

export function ItemIconWrapper({ itemType, wrapperClassName, iconClassName }: ItemIconWrapperProps) {
  return (
    <div className={cn("flex shrink-0 items-center justify-center rounded-full bg-[color-mix(in_srgb,var(--item-color)_12%,transparent)]", wrapperClassName)}>
      <ItemTypeIcon typeName={itemType.name} className={iconClassName} />
    </div>
  )
}
