import type { ReactNode } from 'react'
import { History, Pin } from 'lucide-react'
import type { DashboardData } from '@/hooks/use-dashboard'
import { StatsCards } from '@/components/dashboard/stats-cards'
import { CollectionsWidget } from '@/components/dashboard/collections-widget'
import { ItemListWidget } from '@/components/dashboard/item-list-widget'

type ClassicSkinProps = DashboardData

/**
 * Classic — the free default skin: the page heading, the stat strip, then the three collapsible
 * section cards (Collections, Pinned, Recent). Kept structurally identical to the live app so
 * existing users see no change when the skin system ships.
 */
export function ClassicSkin({
  totalItems,
  totalCollections,
  favoriteItems,
  favoriteCollections,
  collections,
  collectionsPending,
  collectionsError,
  pinned,
  recent,
}: ClassicSkinProps): ReactNode {
  return (
    <>
      <div className="hidden sm:block">
        <h1 className="text-xl font-semibold">Dashboard</h1>
        <p className="text-sm text-muted-foreground">Your developer knowledge hub</p>
      </div>

      <StatsCards
        totalItems={totalItems}
        totalCollections={totalCollections}
        favoriteItems={favoriteItems}
        favoriteCollections={favoriteCollections}
      />

      <CollectionsWidget
        collections={collections}
        isPending={collectionsPending}
        isError={collectionsError}
      />

      <ItemListWidget icon={Pin} title="Pinned" items={pinned} />
      <ItemListWidget icon={History} title="Recent Items" items={recent} />
    </>
  )
}
