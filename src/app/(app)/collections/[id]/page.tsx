import type { CSSProperties } from 'react'
import { notFound } from 'next/navigation'
import Link from 'next/link'
import { ChevronRight, Folder } from 'lucide-react'
import { requireUserId } from '@/lib/session'
import { getCollectionById } from '@/lib/db/collections'
import { getItemsByCollectionPage } from '@/lib/db/items'
import { ItemTypeIcon } from '@/components/shared/item-type-icon'
import { itemCountLabel } from '@/lib/utils/format'
import { CollectionHeaderActions } from '@/components/collections/collection-header-actions'
import { CollectionItemsGrid } from '@/components/collections/collection-items-grid'

interface CollectionPageProps {
  params: Promise<{ id: string }>
}

export default async function CollectionPage({ params }: CollectionPageProps) {
  const { id } = await params
  const userId = await requireUserId()

  const [collection, firstPage] = await Promise.all([
    getCollectionById(userId, id),
    getItemsByCollectionPage(userId, id),
  ])

  if (!collection) notFound()

  return (
    <div className="app-page gap-6 p-6">
      <nav className="flex items-center gap-1 text-sm">
        <Link href="/collections" prefetch={false} className="text-muted-foreground hover:text-foreground transition-colors">Collections</Link>
        <ChevronRight className="size-3.5 text-muted-foreground" />
        <span className="font-medium">{collection.name}</span>
      </nav>

      {/* Compact two-line header: title + inline count/type-icons on line one, single-line
          description on line two, actions vertically centered on the right — about half the
          height of a stacked title / 2-line description / separate meta row. */}
      <div
        className="flex items-center gap-3 border-l-2 border-l-[var(--item-color)] pl-3 sm:pl-4"
        style={{ '--item-color': collection.dominantColor ?? undefined } as CSSProperties}
      >
        <div className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-[var(--item-color)]/12 text-[var(--item-color)]">
          <Folder className="size-5" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 items-center gap-2.5">
            <h1 className="truncate text-lg font-semibold leading-tight sm:text-xl">{collection.name}</h1>
            <span className="shrink-0 text-xs font-medium text-muted-foreground">{itemCountLabel(collection.itemCount)}</span>
            {collection.types.length > 0 && (
              <div className="flex shrink-0 gap-1.5">
                {collection.types.slice(0, 7).map((type) => (
                  <ItemTypeIcon key={type.id} iconName={type.icon} color={type.color} className="size-3.5" />
                ))}
              </div>
            )}
          </div>
          {collection.description && (
            <p className="truncate text-sm text-muted-foreground">{collection.description}</p>
          )}
        </div>
        <div className="shrink-0">
          <CollectionHeaderActions collection={collection} />
        </div>
      </div>

      <CollectionItemsGrid collectionId={id} firstPage={firstPage} />
    </div>
  )
}
