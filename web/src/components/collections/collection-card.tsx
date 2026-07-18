import type { ReactNode } from 'react'
import { Link } from '@tanstack/react-router'
import { FolderOpen } from 'lucide-react'
import type { CollectionWithTypes } from '@/client'
import { itemTypeMeta } from '@/lib/item-types'
import { CARD_SURFACE, cn, hasText } from '@/lib/utils'
import { FavoriteStar } from '@/components/ui/favorite-star'
import { useToggleCollectionFavorite } from '@/hooks/use-collections'

interface CollectionCardProps {
  collection: CollectionWithTypes
}

export function CollectionCard({ collection }: CollectionCardProps): ReactNode {
  const favorite = useToggleCollectionFavorite()
  const types = collection.types ?? []

  return (
    // Stretched-link pattern: the card is a plain div with a full-bleed overlay <Link>,
    // so the favorite <button> is a SIBLING of the anchor (not interactive content nested
    // inside an <a>, which is invalid HTML). The button sits above the overlay via z-10.
    <div className={cn('group relative flex flex-col gap-3', CARD_SURFACE)}>
      <Link
        to="/collections/$id"
        params={{ id: collection.id }}
        aria-label={collection.name}
        className="absolute inset-0 rounded-xl"
      />
      <div className="flex items-center gap-2">
        <FolderOpen className="size-4 text-muted-foreground" />
        <h3 className="truncate text-sm font-medium text-card-foreground">{collection.name}</h3>
        {/* Disabled while in flight: there is no optimistic update, so `collection.isFavorite`
            stays stale for the whole round trip and a second click would re-send the identical
            body — a duplicate toast and a wasted rate-limit token (matches item-card). */}
        <button
          type="button"
          aria-label="Favorite collection"
          title="Favorite collection"
          disabled={favorite.isPending}
          onClick={() => {
            favorite.mutate({
              path: { id: collection.id },
              body: { isFavorite: !collection.isFavorite },
            })
          }}
          className="relative z-10 ml-auto rounded-md p-1 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:pointer-events-none disabled:opacity-50"
        >
          <FavoriteStar isFavorite={collection.isFavorite} />
        </button>
      </div>

      {hasText(collection.description) && (
        <p className="line-clamp-2 text-xs text-muted-foreground">{collection.description}</p>
      )}

      <div className="mt-auto flex items-center justify-between pt-1">
        <span className="font-mono text-[0.65rem] text-muted-foreground/70">
          {collection.itemCount} {collection.itemCount === 1 ? 'item' : 'items'}
        </span>
        <div className="flex items-center gap-1.5">
          {types.slice(0, 5).map((type) => {
            const meta = itemTypeMeta(type.name)
            if (!meta) return null
            const Icon = meta.icon
            return <Icon key={type.id} className={cn('size-3.5', meta.accent)} aria-hidden="true" />
          })}
        </div>
      </div>
    </div>
  )
}
