import type { ReactNode } from 'react'
import { Star } from 'lucide-react'
import { getCurrentUserId } from '@/lib/session'
import { getItemStats } from '@/lib/db/items'
import { getCollectionStats } from '@/lib/db/collections'
import { FavoritesTabNav } from '@/components/favorites/favorites-tab-nav'
import { pluralize } from '@/lib/utils/format'

interface FavoritesLayoutProps {
  children: ReactNode
}

export default async function FavoritesLayout({ children }: FavoritesLayoutProps) {
  const userId = await getCurrentUserId()
  const [itemStats, collectionStats] = await Promise.all([
    userId ? getItemStats(userId) : Promise.resolve({ totalItems: 0, favoriteItems: 0 }),
    userId ? getCollectionStats(userId) : Promise.resolve({ totalCollections: 0, favoriteCollections: 0 }),
  ])
  const total = itemStats.favoriteItems + collectionStats.favoriteCollections

  return (
    <div className="app-page gap-6 p-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="flex size-9 items-center justify-center rounded-lg bg-amber-500/10">
            <Star className="size-4 fill-amber-400 text-amber-400" />
          </div>
          <div>
            <h1 className="text-xl font-semibold leading-tight">Favorites</h1>
            <p className="text-sm text-muted-foreground">
              {total} starred {pluralize(total, 'item')}
            </p>
          </div>
        </div>
        <FavoritesTabNav itemCount={itemStats.favoriteItems} collectionCount={collectionStats.favoriteCollections} />
      </div>

      {children}
    </div>
  )
}
