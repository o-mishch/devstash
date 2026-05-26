import { ItemTypeIcon } from '@/lib/icon-utils'
import type { DashboardItem } from '@/lib/db/items'

interface ItemIconWrapperProps {
  itemType: DashboardItem['itemType']
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
