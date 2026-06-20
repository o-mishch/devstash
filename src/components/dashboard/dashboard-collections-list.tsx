import Link from 'next/link'
import { Folder, Star } from 'lucide-react'
import type { CollectionWithTypes } from '@/types/collection'

// Compact, single-column collections list for skins that place collections in a narrow side column
// (where the full-width CollectionsGrid card grid would be cramped/cut-off). Capped to a short list.
const COLLECTIONS_LIST_LIMIT = 5

interface DashboardCollectionsListProps {
  collections: CollectionWithTypes[]
}

export function DashboardCollectionsList({ collections }: DashboardCollectionsListProps) {
  const items = collections.slice(0, COLLECTIONS_LIST_LIMIT)
  if (items.length === 0) return <p className="text-sm text-muted-foreground">No collections yet.</p>

  return (
    <div className="flex flex-col gap-2">
      {items.map((c) => {
        const color = c.dominantColor ?? 'var(--primary)'
        return (
          <Link
            key={c.id}
            href={`/collections/${c.id}`}
            prefetch={false}
            className="flex items-center gap-3 rounded-xl border border-border bg-card/40 px-3 py-2.5 transition-colors hover:bg-foreground/5"
          >
            <span
              className="grid size-9 shrink-0 place-items-center rounded-lg"
              style={{ background: `color-mix(in srgb, ${color} 16%, transparent)`, color }}
            >
              <Folder className="size-4" />
            </span>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-1.5">
                <h5 className="truncate text-sm font-semibold">{c.name}</h5>
                {c.isFavorite && <Star className="size-3 shrink-0 fill-amber-400 text-amber-400" />}
              </div>
              {c.description && <p className="truncate text-xs text-muted-foreground">{c.description}</p>}
            </div>
            <span className="shrink-0 text-xs text-muted-foreground">
              {c.itemCount} {c.itemCount === 1 ? 'item' : 'items'}
            </span>
          </Link>
        )
      })}
    </div>
  )
}
