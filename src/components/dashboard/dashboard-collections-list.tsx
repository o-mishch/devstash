import { memo, useMemo, type CSSProperties } from 'react'
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
      {items.map((c) => (
        <CollectionRow key={c.id} collection={c} />
      ))}
    </div>
  )
}

interface CollectionRowProps {
  collection: CollectionWithTypes
}

// Extracted + memoized: each row's two style objects depend only on this row's own color, so a
// sibling row's re-render (or the list re-rendering for an unrelated reason) doesn't recreate them.
const CollectionRow = memo(function CollectionRow({ collection: c }: CollectionRowProps) {
  const color = c.dominantColor ?? 'var(--primary)'
  const cardStyle = useMemo(() => ({ '--card-accent': color }) as CSSProperties, [color])
  const iconStyle = useMemo(() => ({ background: `color-mix(in srgb, ${color} 16%, transparent)`, color }), [color])

  return (
    <Link
      href={`/collections/${c.id}`}
      prefetch={false}
      className="card-interactive flex items-center gap-3 rounded-xl border border-l-2 border-border border-l-[var(--card-accent)] bg-card/40 px-3 py-2.5"
      style={cardStyle}
    >
      <span className="grid size-9 shrink-0 place-items-center rounded-lg" style={iconStyle}>
        <Folder className="card-icon size-4" />
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
})
