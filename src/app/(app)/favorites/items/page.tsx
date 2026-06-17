import { getCurrentUserId } from '@/lib/session'
import { getFavoriteItemsPage, getFavoriteItemTypeCounts } from '@/lib/db/items'
import { FavoriteItemsList } from '@/components/favorites/favorite-items-list'
import { FavoritesEmpty } from '@/components/favorites/favorites-empty'

export default async function FavoriteItemsPage() {
  const userId = await getCurrentUserId()

  const emptyPage = { items: [], nextCursor: null, hasMore: false }
  const [firstPage, itemTypeCounts] = await Promise.all([
    userId ? getFavoriteItemsPage(userId) : Promise.resolve(emptyPage),
    userId ? getFavoriteItemTypeCounts(userId) : Promise.resolve<Record<string, number>>({}),
  ])

  const total = Object.values(itemTypeCounts).reduce((a, b) => a + b, 0)
  if (total === 0) return <FavoritesEmpty kind="items" />

  return <FavoriteItemsList firstPage={firstPage} itemTypeCounts={itemTypeCounts} />
}
