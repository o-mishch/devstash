import { getCurrentUserId } from '@/lib/session'
import { getFavoriteCollections } from '@/lib/db/collections'
import { FavoriteCollectionRow } from '@/components/favorites/favorite-collection-row'
import { FavoritesEmpty } from '@/components/favorites/favorites-empty'

export default async function FavoriteCollectionsPage() {
  const userId = await getCurrentUserId()
  const favoriteCollections = userId ? await getFavoriteCollections(userId) : []

  if (favoriteCollections.length === 0) return <FavoritesEmpty kind="collections" />

  return (
    <div className="flex flex-col">
      {favoriteCollections.map((collection) => (
        <FavoriteCollectionRow key={collection.id} collection={collection} />
      ))}
    </div>
  )
}
