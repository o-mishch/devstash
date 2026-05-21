import { Star } from 'lucide-react'
import { Card, CardContent } from '@/components/ui/card'
import { getItemIcon } from '@/lib/db/items'
import type { CollectionWithTypes } from '@/lib/db/collections'

interface CollectionsGridProps {
  collections: CollectionWithTypes[]
}

export function CollectionsGrid({ collections }: CollectionsGridProps) {
  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
      {collections.map((col) => (
        <Card
          key={col.id}
          className="cursor-pointer border-l-2 transition-colors hover:bg-accent/50"
          style={{ borderLeftColor: col.dominantColor ?? undefined }}
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
              {col.types.map((type) => {
                const Icon = getItemIcon(type.icon)
                return Icon ? (
                  <Icon key={type.id} className="size-3.5" style={{ color: type.color }} />
                ) : null
              })}
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  )
}
