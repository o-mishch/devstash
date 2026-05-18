import { mockItemTypes } from '@/lib/mock-data'
import { ItemRow } from './item-row'
import type { Item } from '@/types/item'

interface ItemListProps {
  items: Item[]
}

export function ItemList({ items }: ItemListProps) {
  return (
    <div className="flex flex-col gap-3">
      {items.map((item) => {
        const itemType = mockItemTypes.find((t) => t.id === item.itemTypeId)
        return <ItemRow key={item.id} item={item} itemType={itemType} />
      })}
    </div>
  )
}
