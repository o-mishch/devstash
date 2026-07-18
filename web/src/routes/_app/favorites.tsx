import type { ReactNode } from 'react'
import { createFileRoute } from '@tanstack/react-router'
import { Star } from 'lucide-react'
import { useItemsInfinite } from '@/hooks/use-items'
import { useCollections } from '@/hooks/use-collections'
import { useStats } from '@/hooks/use-stats'
import { DEFAULT_FAVORITES_TAB, favoritesTabSchema } from '@/lib/favorites-tab'
import { PageHeader } from '@/components/app/page-header'
import { ItemList } from '@/components/items/item-list'
import { CollectionsGrid } from '@/components/collections/collections-grid'
import { FavoritesTabNav } from '@/components/favorites/favorites-tab-nav'

export const Route = createFileRoute('/_app/favorites')({
  validateSearch: favoritesTabSchema,
  component: Favorites,
})

function Favorites(): ReactNode {
  const { tab = DEFAULT_FAVORITES_TAB } = Route.useSearch()
  const navigate = Route.useNavigate()
  const stats = useStats()

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        icon={Star}
        iconClassName="text-amber-400"
        title="Favorites"
        description="Items and collections you’ve starred for quick access."
        actions={
          <FavoritesTabNav
            active={tab}
            counts={{
              items: stats.data?.favoriteItems,
              collections: stats.data?.favoriteCollections,
            }}
            onChange={(next) => void navigate({ search: { tab: next }, replace: true })}
          />
        }
      />

      {tab === 'items' ? <FavoriteItems /> : <FavoriteCollections />}
    </div>
  )
}

function FavoriteItems(): ReactNode {
  const items = useItemsInfinite({ type: 'favorites' })
  return (
    <ItemList
      query={items}
      empty={{
        icon: Star,
        title: 'No favorite items yet',
        description: 'Star an item and it’ll show up here.',
      }}
    />
  )
}

function FavoriteCollections(): ReactNode {
  const collections = useCollections()
  const favorites = collections.data?.filter((c) => c.isFavorite)

  return (
    <CollectionsGrid
      data={favorites}
      isPending={collections.isPending}
      isError={collections.isError}
      emptyDescription="Star a collection and it’ll show up here."
    />
  )
}
