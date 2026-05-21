import { ItemRow } from './item-row'
import type { DashboardItem } from '@/lib/db/items'

interface ItemListProps {
  items: DashboardItem[]
}

export function ItemList({ items }: ItemListProps) {
  return (
    <div className="flex flex-col gap-3">
      {items.map((item) => (
        <ItemRow key={item.id} item={item} />
      ))}
    </div>
  )
}
