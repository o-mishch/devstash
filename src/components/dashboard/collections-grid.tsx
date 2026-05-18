import { Star } from 'lucide-react'
import { Card, CardContent } from '@/components/ui/card'
import { mockCollections, mockItems, mockItemCollections, mockItemTypes } from '@/lib/mock-data'
import { ITEM_TYPE_ICONS } from '@/lib/constants/item-types'
import type { ItemType } from '@/types/item'

function getCollectionTypes(collectionId: string): ItemType[] {
  const memberItemIds = mockItemCollections
    .filter((ic) => ic.collectionId === collectionId)
    .map((ic) => ic.itemId)

  const seenTypeIds = new Set<string>()
  const types: ItemType[] = []

  for (const item of mockItems) {
    if (!memberItemIds.includes(item.id)) continue
    if (seenTypeIds.has(item.itemTypeId)) continue
    const type = mockItemTypes.find((t) => t.id === item.itemTypeId)
    if (!type) continue
    seenTypeIds.add(item.itemTypeId)
    types.push(type)
    if (types.length === 4) break
  }

  return types
}

export function CollectionsGrid() {
  const collections = mockCollections.slice(0, 6)

  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
      {collections.map((col) => {
        const types = getCollectionTypes(col.id)

        return (
          <Card key={col.id} className="cursor-pointer transition-colors hover:bg-accent/50">
            <CardContent className="p-4">
              <div className="flex items-center gap-1.5">
                <p className="truncate font-medium">{col.name}</p>
                {col.isFavorite && (
                  <Star className="size-3.5 shrink-0 fill-yellow-400 text-yellow-400" />
                )}
              </div>
              <p className="text-xs text-muted-foreground">{col.itemCount} items</p>
              {col.description && (
                <p className="mt-1.5 line-clamp-2 text-xs text-muted-foreground">
                  {col.description}
                </p>
              )}
              <div className="mt-3 flex gap-1.5">
                {types.map((type) => {
                  const Icon = ITEM_TYPE_ICONS[type.icon]
                  return Icon ? (
                    <Icon key={type.id} className="size-3.5" style={{ color: type.color }} />
                  ) : null
                })}
              </div>
            </CardContent>
          </Card>
        )
      })}
    </div>
  )
}
