'use client'

import { useCollections } from '@/hooks/use-collections'
import { FavoriteCollectionRow } from '@/components/favorites/favorite-collection-row'
import { FavoritesEmpty } from '@/components/favorites/favorites-empty'
import type { CollectionWithTypes } from '@/types/collection'

interface FavoriteCollectionsListProps {
  initialCollections: CollectionWithTypes[]
}

export function FavoriteCollectionsList({ initialCollections }: FavoriteCollectionsListProps) {
  const { collections } = useCollections({ initialData: initialCollections })
  const favoriteCollections = collections.filter((c) => c.isFavorite)

  if (favoriteCollections.length === 0) {
    return <FavoritesEmpty kind="collections" />
  }

  return (
    <div className="flex flex-col gap-1.5">
      {favoriteCollections.map((collection) => (
        <FavoriteCollectionRow key={collection.id} collection={collection} />
      ))}
    </div>
  )
}
