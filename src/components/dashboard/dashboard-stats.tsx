import { StatsCards } from '@/components/dashboard/stats-cards'
import { getItemStats } from '@/lib/db/items'
import { getCollectionStats } from '@/lib/db/collections'

interface DashboardStatsProps {
  userId: string
}

export async function DashboardStats({ userId }: DashboardStatsProps) {
  const [itemStats, collectionStats] = await Promise.all([
    getItemStats(userId),
    getCollectionStats(userId),
  ])

  return (
    <StatsCards
      totalItems={itemStats.totalItems}
      totalCollections={collectionStats.totalCollections}
      favoriteItems={itemStats.favoriteItems}
      favoriteCollections={collectionStats.favoriteCollections}
    />
  )
}
