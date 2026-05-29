import { ItemCard } from '@/components/items/item-card'
import { ImageCard } from '@/components/items/image-card'
import { Card, CardContent } from '@/components/ui/card'
import { ITEM_TYPES_WITH_IMAGE_GRID } from '@/lib/utils/constants'
import type { Item } from '@/types/item'

interface ItemsGridProps {
  items: Item[]
  typeName: string
}

export function ItemsGrid({ items, typeName }: ItemsGridProps) {
  if (items.length === 0) {
    return (
      <Card className="h-20">
        <CardContent className="flex h-full items-center justify-center p-4">
          <p className="text-sm text-muted-foreground">No {typeName}s yet.</p>
        </CardContent>
      </Card>
    )
  }

  if (ITEM_TYPES_WITH_IMAGE_GRID.has(typeName.toLowerCase())) {
    return (
      <div className="grid grid-cols-2 gap-4 md:grid-cols-3 lg:grid-cols-3">
        {items.map((item) => (
          <ImageCard key={item.id} item={item} />
        ))}
      </div>
    )
  }

  return (
    <div className="grid grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-3">
      {items.map((item) => (
        <ItemCard key={item.id} item={item} />
      ))}
    </div>
  )
}
