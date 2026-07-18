import { memo } from 'react'
import type { ReactNode } from 'react'
import { Link } from '@tanstack/react-router'
import { Folder, Star } from 'lucide-react'
import type { CollectionWithTypes } from '@/client'
import { hasText } from '@/lib/utils'

// Compact single-column collections list for skins that place collections in a narrow side column
// (where the full-width card grid would be cramped). Capped to a short list.
const COLLECTIONS_LIST_LIMIT = 5

interface DashboardCollectionsListProps {
  collections: CollectionWithTypes[]
}

export function DashboardCollectionsList({
  collections,
}: DashboardCollectionsListProps): ReactNode {
  const items = collections.slice(0, COLLECTIONS_LIST_LIMIT)
  if (items.length === 0)
    return <p className="text-sm text-muted-foreground">No collections yet.</p>

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

const CollectionRow = memo(function CollectionRow({
  collection: c,
}: CollectionRowProps): ReactNode {
  const color = c.dominantColor ?? 'var(--primary)'
  const cardStyle = { '--card-accent': color }

  return (
    <Link
      to="/collections/$id"
      params={{ id: c.id }}
      className="flex items-center gap-3 rounded-xl border border-l-2 border-border border-l-[var(--card-accent)] bg-card/40 px-3 py-2.5 transition-transform hover:-translate-y-0.5"
      // oxlint-disable-next-line react/forbid-component-props -- dynamic CSS custom property (card accent)
      style={cardStyle}
    >
      <span
        className="grid size-9 shrink-0 place-items-center rounded-lg"
        // oxlint-disable-next-line react/forbid-dom-props -- runtime per-collection accent color
        style={{ background: `color-mix(in srgb, ${color} 16%, transparent)`, color }}
      >
        <Folder className="size-4" />
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          <h5 className="truncate text-sm font-semibold">{c.name}</h5>
          {c.isFavorite && <Star className="size-3 shrink-0 fill-amber-400 text-amber-400" />}
        </div>
        {hasText(c.description) && (
          <p className="truncate text-xs text-muted-foreground">{c.description}</p>
        )}
      </div>
      <span className="shrink-0 text-xs text-muted-foreground">
        {c.itemCount} {c.itemCount === 1 ? 'item' : 'items'}
      </span>
    </Link>
  )
})
