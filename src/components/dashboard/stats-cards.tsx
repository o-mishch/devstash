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
    { label: 'Total Items', value: totalItems, icon: Package, color: '#3b82f6' },
    { label: 'Collections', value: totalCollections, icon: FolderOpen, color: '#8b5cf6' },
    { label: 'Favorite Items', value: favoriteItems, icon: Star, color: '#f97316' },
    { label: 'Favorite Collections', value: favoriteCollections, icon: BookMarked, color: '#10b981' },
  ]

  return (
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
      {stats.map(({ label, value, icon: Icon, color }) => (
        <Card key={label}>
          <CardContent className="p-4">
            <div className="flex items-center gap-4">
              <Icon className="size-8 shrink-0" style={{ color }} />
              <div>
                <p className="text-2xl font-semibold tabular-nums leading-none">{value}</p>
                <p className="mt-1 text-sm text-muted-foreground">{label}</p>
              </div>
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  )
}
