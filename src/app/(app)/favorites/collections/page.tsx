import { requireUserId } from '@/lib/session'
import { getAllCollections } from '@/lib/db/collections'
import { FavoriteCollectionsList } from '@/components/favorites/favorite-collections-list'
import { FavoritesListSkeleton } from '@/components/favorites/favorites-list-skeleton'

interface FavoriteCollectionsPageProps {
  searchParams: Promise<{ skeleton?: string }>
}

export default async function FavoriteCollectionsPage({ searchParams }: FavoriteCollectionsPageProps) {
  const userId = await requireUserId()

  // `?skeleton=true` preview: render the same skeleton loading.tsx shows, after the auth guard.
  if ((await searchParams).skeleton === 'true') return <FavoritesListSkeleton />

  const collections = await getAllCollections(userId)

  return <FavoriteCollectionsList initialCollections={collections} />
}
