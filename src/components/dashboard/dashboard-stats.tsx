import { StatsCards } from '@/components/dashboard/stats-cards'
import type { ItemStats } from '@/types/item'
import type { CollectionStats } from '@/types/collection'

interface DashboardStatsProps {
  statsPromise: Promise<ItemStats>
  collectionStatsPromise: Promise<CollectionStats>
  // Pro swaps the Favorite Collections chip for the inline Brain Dump widget (see StatsCards).
  isPro: boolean
}

export async function DashboardStats({ statsPromise, collectionStatsPromise, isPro }: DashboardStatsProps) {
  const [itemStats, collectionStats] = await Promise.all([statsPromise, collectionStatsPromise])

  return (
    <StatsCards
      totalItems={itemStats.totalItems}
      totalCollections={collectionStats.totalCollections}
      favoriteItems={itemStats.favoriteItems}
      favoriteCollections={collectionStats.favoriteCollections}
      isPro={isPro}
    />
  )
}
