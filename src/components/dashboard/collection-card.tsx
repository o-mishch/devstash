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
      className="group/card relative border-l-2 border-l-[var(--item-color)] transition-colors hover:bg-accent"
      style={{ '--item-color': collection.dominantColor ?? undefined } as CSSProperties}
    >
      <Link href={`/collections/${collection.id}`} className="absolute inset-0 z-10 rounded-xl" aria-label={`View ${collection.name}`} />
      <CardContent className="p-4">
        <div className="flex items-center gap-1.5 pr-16">
          <p className="truncate font-medium">{collection.name}</p>
        </div>
        <p className="text-xs text-muted-foreground mt-1">{collection.itemCount} items</p>
        {collection.description && (
          <p className="mt-1.5 line-clamp-2 text-xs text-muted-foreground">
            {collection.description}
          </p>
        )}
        <div className="mt-3 flex gap-1.5">
          {collection.types.map((type) => (
            <ItemTypeIcon key={type.id} iconName={type.icon} color={type.color} className="size-3.5" />
          ))}
        </div>
      </CardContent>

      <CollectionCardActions collection={collection} />
    </Card>
  )
}

