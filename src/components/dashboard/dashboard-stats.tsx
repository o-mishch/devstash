import { StatsCards } from '@/components/dashboard/stats-cards'
import type { ItemStats } from '@/types/item'
import type { CollectionStats } from '@/types/collection'

interface DashboardStatsProps {
  statsPromise: Promise<ItemStats>
  collectionStatsPromise: Promise<CollectionStats>
}

export async function DashboardStats({ statsPromise, collectionStatsPromise }: DashboardStatsProps) {
  const [itemStats, collectionStats] = await Promise.all([statsPromise, collectionStatsPromise])

  return (
    <StatsCards
      totalItems={itemStats.totalItems}
      totalCollections={collectionStats.totalCollections}
      favoriteItems={itemStats.favoriteItems}
      favoriteCollections={collectionStats.favoriteCollections}
    />
  )
}
