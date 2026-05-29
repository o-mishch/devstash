import Link from 'next/link'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { CollectionsGrid } from '@/components/dashboard/collections-grid'
import { getAllCollections } from '@/lib/db/collections'

interface DashboardCollectionsProps {
  userId: string
}

export async function DashboardCollections({ userId }: DashboardCollectionsProps) {
  const collections = (await getAllCollections(userId)).slice(0, 6)

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between pb-3">
        <CardTitle className="text-sm font-semibold">Collections</CardTitle>
        <Link href="/collections" className="text-xs text-muted-foreground hover:text-foreground transition-colors">
          View all
        </Link>
      </CardHeader>
      <CardContent>
        <CollectionsGrid collections={collections} />
      </CardContent>
    </Card>
  )
}
