import { Package, FolderOpen, Star, BookMarked } from 'lucide-react'
import { Card, CardContent } from '@/components/ui/card'

interface StatsCardsProps {
  totalItems: number
  totalCollections: number
  favoriteItems: number
  favoriteCollections: number
}

export function StatsCards({
  totalItems,
  totalCollections,
  favoriteItems,
  favoriteCollections,
}: StatsCardsProps) {
  const stats = [
    { label: 'Total Items', value: totalItems, icon: Package },
    { label: 'Collections', value: totalCollections, icon: FolderOpen },
    { label: 'Favorite Items', value: favoriteItems, icon: Star },
    { label: 'Favorite Collections', value: favoriteCollections, icon: BookMarked },
  ]

  return (
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
      {stats.map(({ label, value, icon: Icon }) => (
        <Card key={label}>
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <p className="text-sm text-muted-foreground">{label}</p>
              <Icon className="size-4 text-muted-foreground" />
            </div>
            <p className="mt-2 text-2xl font-semibold tabular-nums">{value}</p>
          </CardContent>
        </Card>
      ))}
    </div>
  )
}
