import { Suspense } from 'react'
import { getCurrentUserId } from '@/lib/session'
import { getFavoriteItemsPage, getFavoriteItemTypeCounts } from '@/lib/db/items'
import { FavoriteItemsList } from '@/components/favorites/favorite-items-list'
import { FavoriteItemsSkeleton } from '@/components/favorites/favorites-list-skeleton'
import { FavoritesEmpty } from '@/components/favorites/favorites-empty'
import { ItemDeepLink } from '@/components/items/item-deep-link'

interface FavoriteItemsPageProps {
  searchParams: Promise<{ skeleton?: string }>
}

export default async function FavoriteItemsPage({ searchParams }: FavoriteItemsPageProps) {
  // `?skeleton=true` preview: render the same skeleton loading.tsx shows.
  if ((await searchParams).skeleton === 'true') return <FavoriteItemsSkeleton />

  const userId = await getCurrentUserId()

  const emptyPage = { items: [], nextCursor: null, hasMore: false }
  const [firstPage, itemTypeCounts] = await Promise.all([
    userId ? getFavoriteItemsPage(userId) : Promise.resolve(emptyPage),
    userId ? getFavoriteItemTypeCounts(userId) : Promise.resolve<Record<string, number>>({}),
  ])

  const total = Object.values(itemTypeCounts).reduce((a, b) => a + b, 0)
  if (total === 0) return <FavoritesEmpty kind="items" />

  return (
    <>
      <Suspense fallback={null}>
        <ItemDeepLink />
      </Suspense>
      <FavoriteItemsList firstPage={firstPage} itemTypeCounts={itemTypeCounts} />
    </>
  )
}
