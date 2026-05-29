import { VirtualImageGrid } from '@/components/items/virtual-image-grid'
import { VirtualItemGrid } from '@/components/items/virtual-item-grid'
import { VirtualFileList } from '@/components/items/virtual-file-list'
import { Card, CardContent } from '@/components/ui/card'
import { ITEM_TYPES_WITH_IMAGE_GRID, ITEM_TYPES_WITH_FILE_LIST } from '@/lib/utils/constants'
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

  if (ITEM_TYPES_WITH_IMAGE_GRID.has(typeName)) return <VirtualImageGrid items={items} />
  if (ITEM_TYPES_WITH_FILE_LIST.has(typeName)) return <VirtualFileList items={items} />
  return <VirtualItemGrid items={items} />
}
