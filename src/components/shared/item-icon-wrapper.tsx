import { ItemTypeIcon } from '@/components/shared/item-type-icon'
import type { ItemType } from '@/types/item'

interface ItemIconWrapperProps {
  itemType: ItemType
  wrapperClassName?: string
  iconClassName?: string
}

export function ItemIconWrapper({ itemType, wrapperClassName = '', iconClassName = '' }: ItemIconWrapperProps) {
  return (
    <div className={`type-icon-bg flex shrink-0 items-center justify-center rounded-full ${wrapperClassName}`.trim()}>
      <ItemTypeIcon iconName={itemType.icon} color={itemType.color} className={iconClassName} />
    </div>
  )
}
