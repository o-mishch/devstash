import { notFound } from 'next/navigation'
import Link from 'next/link'
import { ChevronRight } from 'lucide-react'
import { getCurrentUserId } from '@/lib/session'
import { getCollectionById } from '@/lib/db/collections'
import { getItemsByCollectionPage } from '@/lib/db/items'
import { CollectionHeaderActions } from './_components/collection-header-actions'
import { CollectionItemsGrid } from './_components/collection-items-grid'

interface CollectionPageProps {
  params: Promise<{ id: string }>
}

export default async function CollectionPage({ params }: CollectionPageProps) {
  const { id } = await params
  const userId = await getCurrentUserId()

  if (!userId) notFound()

  const [collection, firstPage] = await Promise.all([
    getCollectionById(userId, id),
    getItemsByCollectionPage(userId, id),
  ])

  if (!collection) notFound()

  return (
    <div className="flex flex-col gap-6 p-6">
      <div>
        <nav className="mb-1 flex items-center gap-1 text-xs text-muted-foreground">
          <Link href="/collections" className="hover:text-foreground transition-colors">Collections</Link>
          <ChevronRight className="size-3" />
          <span className="text-foreground">{collection.name}</span>
        </nav>
        <div className="flex items-start justify-between">
          <div>
            <h1 className="text-xl font-semibold">{collection.name}</h1>
            {collection.description && (
              <p className="mt-0.5 text-sm text-muted-foreground">{collection.description}</p>
            )}
            <p className="mt-1 text-sm text-muted-foreground">
              {firstPage.items.length}{firstPage.hasMore ? '+' : ''} item{firstPage.items.length !== 1 ? 's' : ''}
            </p>
          </div>
          <CollectionHeaderActions collection={collection} />
        </div>
      </div>

      <CollectionItemsGrid collectionId={id} firstPage={firstPage} />
    </div>
  )
}
