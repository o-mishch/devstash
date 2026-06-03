import { notFound } from 'next/navigation'
import Link from 'next/link'
import { ChevronRight } from 'lucide-react'
import { requireUserId } from '@/lib/session'
import { getCollectionById } from '@/lib/db/collections'
import { getItemsByCollectionPage } from '@/lib/db/items'
import { CollectionHeaderActions } from './_components/collection-header-actions'
import { CollectionItemsGrid } from './_components/collection-items-grid'

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
    <div className="flex flex-col gap-6 p-6">
      <div className="flex items-center justify-between">
        <nav className="flex items-center gap-1 text-sm">
          <Link href="/collections" className="text-muted-foreground hover:text-foreground transition-colors">Collections</Link>
          <ChevronRight className="size-3.5 text-muted-foreground" />
          <span className="font-medium">{collection.name}</span>
        </nav>
        <CollectionHeaderActions collection={collection} />
      </div>

      <CollectionItemsGrid collectionId={id} firstPage={firstPage} />
    </div>
  )
}
