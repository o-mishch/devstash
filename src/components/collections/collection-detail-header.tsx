'use client'

import { type CSSProperties } from 'react'
import { Folder } from 'lucide-react'
import { useCollection } from '@/hooks/items/use-collections'
import { ItemTypeIcon } from '@/components/shared/item-type-icon'
import { itemCountLabel } from '@/lib/utils/format'
import { CollectionHeaderActions } from '@/components/collections/collection-header-actions'
import type { CollectionWithTypes } from '@/types/collection'

interface CollectionDetailHeaderProps {
  initialCollection: CollectionWithTypes
}

export function CollectionDetailHeader({ initialCollection }: CollectionDetailHeaderProps) {
  const { collection } = useCollection(initialCollection.id, initialCollection)
  const currentCollection = collection || initialCollection

  return (
    <div
      className="flex items-center gap-3 border-l-2 border-l-[var(--item-color)] pl-3 sm:pl-4"
      style={{ '--item-color': currentCollection.dominantColor ?? undefined } as CSSProperties}
    >
      <div className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-[var(--item-color)]/12 text-[var(--item-color)]">
        <Folder className="size-5" />
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex min-w-0 items-center gap-2.5">
          <h1 className="truncate text-lg font-semibold leading-tight sm:text-xl">
            {currentCollection.name}
          </h1>
          <span className="shrink-0 text-xs font-medium text-muted-foreground">
            {itemCountLabel(currentCollection.itemCount)}
          </span>
          {currentCollection.types.length > 0 && (
            <div className="flex shrink-0 gap-1.5">
              {currentCollection.types.slice(0, 7).map((type) => (
                <ItemTypeIcon
                  key={type.id}
                  iconName={type.icon}
                  color={type.color}
                  className="size-3.5"
                />
              ))}
            </div>
          )}
        </div>
        {currentCollection.description && (
          <p className="truncate text-sm text-muted-foreground">{currentCollection.description}</p>
        )}
      </div>
      <div className="shrink-0">
        <CollectionHeaderActions collection={currentCollection} />
      </div>
    </div>
  )
}
