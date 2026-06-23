import { getCurrentUserId } from '@/lib/session'
import { getFavoriteCollections } from '@/lib/db/collections'
import { FavoriteCollectionRow } from '@/components/favorites/favorite-collection-row'
import { FavoritesListSkeleton } from '@/components/favorites/favorites-list-skeleton'
import { FavoritesEmpty } from '@/components/favorites/favorites-empty'

interface FavoriteCollectionsPageProps {
  searchParams: Promise<{ skeleton?: string }>
}

export default async function FavoriteCollectionsPage({ searchParams }: FavoriteCollectionsPageProps) {
  // `?skeleton=true` preview: render the same skeleton loading.tsx shows.
  if ((await searchParams).skeleton === 'true') return <FavoritesListSkeleton />

  const userId = await getCurrentUserId()
  const favoriteCollections = userId ? await getFavoriteCollections(userId) : []

  if (favoriteCollections.length === 0) return <FavoritesEmpty kind="collections" />

  return (
    <div className="flex flex-col gap-1.5">
      {favoriteCollections.map((collection) => (
        <FavoriteCollectionRow key={collection.id} collection={collection} />
      ))}
    </div>
  )
}
