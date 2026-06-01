import Link from 'next/link'
import type { CollectionWithTypes } from '@/types/collection'
import { formatDate } from '@/lib/utils'
import { FolderOpen } from 'lucide-react'

interface FavoriteCollectionRowProps {
  collection: CollectionWithTypes
}

export function FavoriteCollectionRow({ collection }: FavoriteCollectionRowProps) {
  const dotColor = collection.dominantColor ?? '#6b7280'

  return (
    <Link
      href={`/collections/${collection.id}`}
      id={`favorite-collection-${collection.id}`}
      className="group flex w-full items-center gap-3 rounded px-3 py-1.5 text-left transition-colors hover:bg-accent"
    >
      <FolderOpen
        className="size-3.5 shrink-0"
        style={{ color: dotColor }}
      />
      <span className="min-w-0 flex-1 truncate text-sm">
        {collection.name}
      </span>
      <span className="shrink-0 rounded border border-border px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground">
        collection
      </span>
      <span className="w-16 shrink-0 text-right font-mono text-xs text-muted-foreground">
        {formatDate(collection.createdAt)}
      </span>
    </Link>
  )
}
