import { ItemCard } from '@/components/items/item-card'
import { Card, CardContent } from '@/components/ui/card'
import { getItemsByType } from '@/lib/db/items'

interface ItemsGridProps {
  userId: string
  typeName: string
}

export async function ItemsGrid({ userId, typeName }: ItemsGridProps) {
  const items = await getItemsByType(userId, typeName)

  if (items.length === 0) {
    return (
      <Card>
        <CardContent className="p-6">
          <p className="text-sm text-muted-foreground">No {typeName}s yet.</p>
        </CardContent>
      </Card>
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
