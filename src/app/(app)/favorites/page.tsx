import { Star } from 'lucide-react'
import { getCurrentUserId } from '@/lib/session'
import { getFavoriteItemsPage } from '@/lib/db/items'
import { getFavoriteCollections } from '@/lib/db/collections'
import { compareBySystemTypeOrder } from '@/lib/utils/constants'
import { FavoriteItemsList } from '@/components/favorites/favorite-items-list'
import { FavoriteCollectionRow } from '@/components/favorites/favorite-collection-row'

export default async function FavoritesPage() {
  const userId = await getCurrentUserId()

  const emptyPage = { items: [], nextCursor: null, hasMore: false }
  const [rawFirstPage, favoriteCollections] = await Promise.all([
    userId ? getFavoriteItemsPage(userId) : Promise.resolve(emptyPage),
    userId ? getFavoriteCollections(userId) : Promise.resolve([]),
  ])

  const firstPage = {
    ...rawFirstPage,
    items: [...rawFirstPage.items].sort((a, b) => compareBySystemTypeOrder(a.itemType, b.itemType)),
  }

  const totalFavorites = firstPage.items.length + favoriteCollections.length
  const isEmpty = totalFavorites === 0 && !firstPage.hasMore

  return (
    <div className="flex flex-col gap-6 p-6">
      <div>
        <h1 className="text-xl font-semibold">Favorites</h1>
        <p className="text-sm text-muted-foreground">
          {isEmpty ? 'Nothing favorited yet' : 'Your starred items and collections'}
        </p>
      </div>

      {isEmpty ? (
        <div className="flex flex-col items-center justify-center gap-3 rounded-lg border border-dashed border-border py-16 text-center">
          <Star className="size-8 text-muted-foreground/40" />
          <div>
            <p className="font-mono text-sm text-muted-foreground">No favorites yet</p>
            <p className="mt-1 font-mono text-xs text-muted-foreground/60">
              Star items and collections to find them here
            </p>
          </div>
        </div>
      ) : (
        <div className="flex flex-col gap-6">
          {/* Items section */}
          {(firstPage.items.length > 0 || firstPage.hasMore) && (
            <section>
              <div className="mb-1 flex items-center gap-2 px-3 pb-1 border-b border-border">
                <span className="font-mono text-xs font-medium uppercase tracking-widest text-muted-foreground">
                  Items
                </span>
                {!firstPage.hasMore && (
                  <span className="font-mono text-xs text-muted-foreground/60">
                    — {firstPage.items.length}
                  </span>
                )}
              </div>
              <FavoriteItemsList firstPage={firstPage} />
            </section>
          )}

          {/* Collections section */}
          {favoriteCollections.length > 0 && (
            <section>
              <div className="mb-1 flex items-center gap-2 px-3 pb-1 border-b border-border">
                <span className="font-mono text-xs font-medium uppercase tracking-widest text-muted-foreground">
                  Collections
                </span>
                <span className="font-mono text-xs text-muted-foreground/60">
                  — {favoriteCollections.length}
                </span>
              </div>
              <div className="flex flex-col">
                {favoriteCollections.map((collection) => (
                  <FavoriteCollectionRow key={collection.id} collection={collection} />
                ))}
              </div>
            </section>
          )}
        </div>
      )}
    </div>
  )
}
