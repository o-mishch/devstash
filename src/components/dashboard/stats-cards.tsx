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
    <div className="app-grid grid-cols-2 gap-2 sm:gap-3 lg:grid-cols-4">
      {stats.map(({ label, value, icon: Icon, color }) => (
        <Card key={label} className="min-w-0">
          <CardContent className="p-3 sm:p-4">
            <div className="flex min-w-0 items-center gap-2 sm:gap-3">
              <Icon className="size-5 shrink-0 sm:size-7" style={{ color }} aria-hidden="true" />
              <div className="min-w-0">
                <p className="text-lg font-semibold tabular-nums leading-none sm:text-2xl">{value}</p>
                <p className="mt-0.5 text-[11px] text-muted-foreground sm:mt-1 sm:text-sm">{label}</p>
              </div>
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  )
}
