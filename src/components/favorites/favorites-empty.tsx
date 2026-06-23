import { Star } from 'lucide-react'

interface FavoritesEmptyProps {
  kind: 'items' | 'collections'
}

export function FavoritesEmpty({ kind }: FavoritesEmptyProps) {
  return (
    <div className="card-surface card-hover group flex flex-col items-center justify-center gap-4 rounded-xl border border-dashed border-border py-20 text-center">
      <div className="flex size-14 items-center justify-center rounded-full bg-amber-500/10">
        <Star className="card-icon size-6 text-amber-400/60" />
      </div>
      <div>
        <p className="text-sm font-medium text-foreground">No favorite {kind} yet</p>
        <p className="mt-1 text-xs text-muted-foreground">Star {kind} to find them here</p>
      </div>
    </div>
  )
}
