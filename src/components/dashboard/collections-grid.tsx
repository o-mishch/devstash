import type { CSSProperties } from 'react'
import { Star } from 'lucide-react'
import { Card, CardContent } from '@/components/ui/card'
import { ItemTypeIcon } from '@/components/shared/item-type-icon'
import type { CollectionWithTypes } from '@/types/collection'

interface CollectionsGridProps {
  collections: CollectionWithTypes[]
}

export function CollectionsGrid({ collections }: CollectionsGridProps) {
  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
      {collections.map((col) => (
        <Card
          key={col.id}
          className="type-border-l cursor-pointer transition-colors hover:bg-accent"
          style={{ '--item-color': col.dominantColor ?? undefined } as CSSProperties}
        >
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
              {col.types.map((type) => (
                <ItemTypeIcon key={type.id} iconName={type.icon} color={type.color} className="size-3.5" />
              ))}
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  )
}
