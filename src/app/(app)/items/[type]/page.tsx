import { notFound } from 'next/navigation'
import { ItemCard } from '@/components/items/item-card'
import { Card, CardContent } from '@/components/ui/card'
import { getCurrentUserId } from '@/lib/db/collections'
import { getItemsByType, getItemTypeBySlug } from '@/lib/db/items'

interface ItemsPageProps {
  params: Promise<{ type: string }>
}

export default async function ItemsPage({ params }: ItemsPageProps) {
  const { type: typeSlug } = await params

  const itemType = await getItemTypeBySlug(typeSlug)
  if (!itemType) notFound()

  const userId = await getCurrentUserId()
  const items = userId ? await getItemsByType(userId, itemType.name) : []

  const label = itemType.name.charAt(0).toUpperCase() + itemType.name.slice(1) + 's'

  return (
    <div className="flex flex-col gap-6 p-6">
      <div>
        <h1 className="text-xl font-semibold">{label}</h1>
        <p className="text-sm text-muted-foreground">
          {items.length} {items.length === 1 ? itemType.name : itemType.name + 's'}
        </p>
      </div>

      {items.length === 0 ? (
        <Card>
          <CardContent className="p-6">
            <p className="text-sm text-muted-foreground">No {itemType.name}s yet.</p>
          </CardContent>
        </Card>
      ) : (
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          {items.map((item) => (
            <ItemCard key={item.id} item={item} />
          ))}
        </div>
      )}
    </div>
  )
}
