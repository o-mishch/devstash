import { Star } from 'lucide-react'
import { getCurrentUserId } from '@/lib/session'
import { getFavoriteItemsPage, getFavoriteItemTypeCounts } from '@/lib/db/items'
import { getFavoriteCollections } from '@/lib/db/collections'
import { FavoriteItemsList } from '@/components/favorites/favorite-items-list'
import { FavoriteCollectionRow } from '@/components/favorites/favorite-collection-row'

export default async function FavoritesPage() {
  const userId = await getCurrentUserId()

  const emptyPage = { items: [], nextCursor: null, hasMore: false }
  const [firstPage, favoriteCollections, itemTypeCounts] = await Promise.all([
    userId ? getFavoriteItemsPage(userId) : Promise.resolve(emptyPage),
    userId ? getFavoriteCollections(userId) : Promise.resolve([]),
    userId ? getFavoriteItemTypeCounts(userId) : Promise.resolve({}),
  ])

  const totalFavorites = firstPage.items.length + favoriteCollections.length
  const isEmpty = totalFavorites === 0 && !firstPage.hasMore

  return (
    <div className="flex flex-col gap-6 p-6">
      <div className="flex items-center gap-3">
        <div className="flex size-9 items-center justify-center rounded-lg bg-amber-500/10">
          <Star className="size-4 fill-amber-400 text-amber-400" />
        </div>
        <div>
          <h1 className="text-xl font-semibold leading-tight">Favorites</h1>
          <p className="text-sm text-muted-foreground">
            {isEmpty
              ? 'Nothing favorited yet'
              : `${totalFavorites}${firstPage.hasMore ? '+' : ''} starred ${totalFavorites === 1 ? 'item' : 'items'}`}
          </p>
        </div>
      </div>

      {isEmpty ? (
        <div className="flex flex-col items-center justify-center gap-4 rounded-xl border border-dashed border-border py-20 text-center">
          <div className="flex size-14 items-center justify-center rounded-full bg-amber-500/10">
            <Star className="size-6 text-amber-400/60" />
          </div>
          <div>
            <p className="text-sm font-medium text-foreground">No favorites yet</p>
            <p className="mt-1 text-xs text-muted-foreground">
              Star items and collections to find them here
            </p>
          </div>
        </div>
      ) : (
        <div className="flex flex-col gap-6">
          {/* Items section */}
          {(firstPage.items.length > 0 || firstPage.hasMore) && (
            <section>
              <div className="mb-2 flex items-center gap-2 px-3 pb-2 border-b border-border">
                <span className="font-mono text-[11px] font-semibold uppercase tracking-widest text-muted-foreground">
                  Items
                </span>
                {!firstPage.hasMore && (
                  <span className="rounded bg-muted px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground">
                    {firstPage.items.length}
                  </span>
                )}
              </div>
              <FavoriteItemsList firstPage={firstPage} itemTypeCounts={itemTypeCounts} />
            </section>
          )}

          {/* Collections section */}
          {favoriteCollections.length > 0 && (
            <section>
              <div className="mb-2 flex items-center gap-2 px-3 pb-2 border-b border-border">
                <span className="font-mono text-[11px] font-semibold uppercase tracking-widest text-muted-foreground">
                  Collections
                </span>
                <span className="rounded bg-muted px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground">
                  {favoriteCollections.length}
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
