import { Star } from 'lucide-react'
import { getCurrentUserId } from '@/lib/session'
import { getFavoriteItemsPage, getFavoriteItemTypeCounts } from '@/lib/db/items'
import { getFavoriteCollections } from '@/lib/db/collections'
import { FavoriteItemsList } from '@/components/favorites/favorite-items-list'
import { FavoriteCollectionRow } from '@/components/favorites/favorite-collection-row'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'

export default async function FavoritesPage() {
  const userId = await getCurrentUserId()

  const emptyPage = { items: [], nextCursor: null, hasMore: false }
  const [firstPage, favoriteCollections, itemTypeCounts] = await Promise.all([
    userId ? getFavoriteItemsPage(userId) : Promise.resolve(emptyPage),
    userId ? getFavoriteCollections(userId) : Promise.resolve([]),
    userId ? getFavoriteItemTypeCounts(userId) : Promise.resolve({}),
  ])

  const counts = Object.values(itemTypeCounts) as number[]
  const totalItemCount = counts.reduce((a, b) => a + b, 0)
  const totalFavorites = totalItemCount + favoriteCollections.length
  const isEmpty = totalFavorites === 0

  return (
    <Tabs defaultValue={totalItemCount > 0 ? 'items' : 'collections'} className="app-page gap-6 p-6">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div className="flex items-center gap-3">
          <div className="flex size-9 items-center justify-center rounded-lg bg-amber-500/10">
            <Star className="size-4 fill-amber-400 text-amber-400" />
          </div>
          <div>
            <h1 className="text-xl font-semibold leading-tight">Favorites</h1>
            <p className="text-sm text-muted-foreground">
              {isEmpty
                ? 'Nothing favorited yet'
                : `${totalFavorites} starred ${totalFavorites === 1 ? 'item' : 'items'}`}
            </p>
          </div>
        </div>

        {!isEmpty && (
          <TabsList>
            <TabsTrigger value="items" disabled={totalItemCount === 0}>
              Items <span className="ml-1.5 rounded-full bg-muted-foreground/15 px-2 py-0.5 text-xs">{totalItemCount}</span>
            </TabsTrigger>
            <TabsTrigger value="collections" disabled={favoriteCollections.length === 0}>
              Collections <span className="ml-1.5 rounded-full bg-muted-foreground/15 px-2 py-0.5 text-xs">{favoriteCollections.length}</span>
            </TabsTrigger>
          </TabsList>
        )}
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
        <>
          <TabsContent value="items" className="mt-0">
            <FavoriteItemsList firstPage={firstPage} itemTypeCounts={itemTypeCounts} />
          </TabsContent>

          <TabsContent value="collections" className="mt-0">
            <div className="flex flex-col">
              {favoriteCollections.map((collection) => (
                <FavoriteCollectionRow key={collection.id} collection={collection} />
              ))}
            </div>
          </TabsContent>
        </>
      )}
    </Tabs>
  )
}
