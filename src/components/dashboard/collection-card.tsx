import type { CSSProperties } from 'react'
import Link from 'next/link'
import { Card, CardContent } from '@/components/ui/card'
import { ItemTypeIcon } from '@/components/shared/item-type-icon'
import { CollectionCardActions } from './collection-card-actions'
import type { CollectionWithTypes } from '@/types/collection'

interface CollectionCardProps {
  collection: CollectionWithTypes
}

export function CollectionCard({ collection }: CollectionCardProps) {
  return (
    <Card
      className="card-interactive group/card relative h-20 gap-0 py-0 border-l-2 border-l-[var(--item-color)]"
      style={{ '--item-color': collection.dominantColor ?? undefined } as CSSProperties}
    >
      <Link href={`/collections/${collection.id}`} className="absolute inset-0 z-10 rounded-xl" aria-label={`View ${collection.name}`} />
      <CardContent className="flex h-full flex-col justify-center p-3 sm:p-4 pr-20">
        <div className="min-w-0 w-full">
          <p className="truncate font-medium text-sm">{collection.name}</p>
          {collection.description && (
            <p className="mt-0.5 truncate text-xs text-muted-foreground">
              {collection.description}
            </p>
          )}
          <div className="mt-1.5 flex items-center gap-3">
            <span className="text-[11px] font-medium text-muted-foreground shrink-0">{collection.itemCount} items</span>
            {collection.types.length > 0 && (
              <div className="flex gap-1.5">
                {collection.types.slice(0, 5).map((type) => (
                  <ItemTypeIcon key={type.id} iconName={type.icon} color={type.color} className="size-3" />
                ))}
              </div>
            )}
          </div>
        </div>
      </CardContent>
      <CollectionCardActions collection={collection} />
    </Card>
  )
}

